const express = require('express');
const auth = require('../middleware/auth');
const crypto = require('crypto');
const { createLimiter, limitBy } = require('../middleware/rateLimit');
const secretBox = require('../services/secretBox');
const { PROVIDER_IDS, AiError, listLocalModels } = require('../services/aiProviders');
const ai = require('../services/aiService');
const User = require('../models/User');
const { isValidSymbol } = require('../services/futuresUtils');
const { isKnownSymbol } = require('../services/futuresRest');

const router = express.Router();
router.use(auth);
router.use((req, res, next) => (req.user && req.user.userId ? next() : res.status(401).json({ success: false, message: 'Invalid token' })));

// One user lookup per request. Builds the settings object aiService works from. keyEnc stays ENCRYPTED here and is only
// decrypted inside aiService when a call actually goes out. `provider` overrides the user's selection (POST /test).
const settingsFor = async (userId, provider) => {
    const u = await User.findById(userId).select('ai').lean();
    const a = (u && u.ai) || {};
    const id = provider || a.provider || 'default';
    const p = (a.providers && a.providers[id]) || {};
    return {
        userId: String(userId), provider: id,
        model: id === 'default' ? a.model || null : p.model || '',
        keyEnc: p.keyEnc || null, baseUrl: p.baseUrl || '',
        systemPrompt: a.systemPrompt || '', temperature: typeof a.temperature === 'number' ? a.temperature : null,
        length: a.length || 'normal', includePortfolio: a.includePortfolio === true,
    };
};

// Per-user limit shared by brief/ask/alerts-parse: 10 requests per rolling minute. Called AFTER input validation so
// invalid requests don't burn quota. Returns true when it already sent the 429.
const check = createLimiter({ limit: 10, windowMs: 60000 });
const limited = (req, res) => check(req.user.userId, res);

// Process-wide billed-call ceiling (AI_MAX_CALLS_PER_HOUR). brief/ask take their slot inside the service after market data
// is gathered; alerts/parse has no gather step so it checks here.
// Only the server's own credentials are budgeted: bring-your-own-key calls are billed to the user's key.
function overBudget(res, settings) {
    if (settings.provider !== 'default') return false;
    const wait = ai.spend();
    if (!wait) return false;
    res.set('Retry-After', String(wait));
    res.status(429).json({ error: 'rate_limited' });
    return true;
}

const noMarket = (res, symbol) => res.status(404).json({ error: `No perpetual futures market for ${symbol}` });

const BRIEF_TTL_MS = 5 * 60 * 1000;
const briefCache = new Map(); // key -> { exp, body } | { exp, p } in flight; key = [user|]symbol|provider|model|hash(style prompt + length)
// ponytail: unbounded by symbol count but only valid symbols that succeeded are stored; cap if abused.

const fail = (res, err) => { if (err && err.retryAfter) res.set('Retry-After', String(err.retryAfter)); const m = ai.mapError(err); res.status(m.status).json(m.body); };

router.get('/status', async (req, res) => {
    try {
        const st = await settingsFor(req.user.userId);
        const byo = st.provider !== 'default';
        const server = byo ? null : await ai.provider();
        const configured = byo ? st.provider === 'lmstudio' || (!!st.keyEnc && (st.provider !== 'custom' || !!st.baseUrl)) : server !== null;
        res.json({ configured, model: ai.modelOf(st), provider: byo ? st.provider : server });
    } catch (err) { fail(res, new AiError(500, 'ai_error')); } // Express 4 does not catch async rejections
});

router.get('/brief/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!(await isKnownSymbol(symbol))) return noMarket(res, symbol);
    if (limited(req, res)) return;
    try {
        const st = await settingsFor(req.user.userId);
        const model = ai.modelOf(st);
        // Never serve one user's result to another when it came from their own key or their own portfolio.
        const scope = st.provider !== 'default' || st.includePortfolio ? `${st.userId}|` : '';
        const style = crypto.createHash('sha256').update(`${st.systemPrompt}\u0000${st.length}`).digest('hex').slice(0, 16);
        const key = `${scope}${symbol}|${st.provider}|${model}|${style}`;
        let c = briefCache.get(key);
        if (!c || c.exp < Date.now()) {
            const p = ai.brief(symbol, st).then((brief) => ({ symbol, generatedAt: Date.now(), model, brief }));
            c = { exp: Date.now() + BRIEF_TTL_MS, p };
            briefCache.set(key, c);
            p.catch(() => { if (briefCache.get(key) === c) briefCache.delete(key); }); // never cache failures
        }
        res.json(await c.p);
    } catch (err) { fail(res, err); }
});

router.post('/ask', async (req, res) => {
    const b = req.body || {};
    const symbol = typeof b.symbol === 'string' ? b.symbol.toUpperCase() : '';
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    const q = typeof b.question === 'string' ? b.question.trim() : '';
    if (q.length < 3 || q.length > 500) return res.status(400).json({ error: 'question must be 3..500 chars' });
    if (!(await isKnownSymbol(symbol))) return noMarket(res, symbol);
    if (limited(req, res)) return;
    try { res.json({ answer: await ai.ask(symbol, q, await settingsFor(req.user.userId)) }); } catch (err) { fail(res, err); }
});

router.post('/alerts/parse', async (req, res) => {
    const t = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (t.length < 3 || t.length > 300) return res.status(400).json({ error: 'text must be 3..300 chars' });
    if (limited(req, res)) return;
    try {
        const st = await settingsFor(req.user.userId);
        if (overBudget(res, st)) return;
        const d = await ai.parseAlert(t, st);
        // validate the draft like a real alert so the client can POST it as-is
        const ok = d.parsed && Number.isFinite(d.value) && await isKnownSymbol(d.symbol);
        if (!ok) return res.status(422).json({ error: 'could_not_parse', reason: d.parsed ? 'model returned an invalid draft' : (d.reason || 'could not map the text to an alert') });
        res.json({ draft: { symbol: d.symbol, metric: d.metric, op: d.op, value: d.value, note: d.note.slice(0, 140) } });
    } catch (err) { fail(res, err); }
});

// ---- bring-your-own-key management. Keys are encrypted with an AAD bound to user+provider and never read back. ----
const keyLimit = limitBy({ limit: 20, windowMs: 60000 }, (req) => req.user.userId);
const byoId = (req, res) => {
    const id = String(req.params.provider);
    if (PROVIDER_IDS.includes(id)) return id;
    res.status(400).json({ error: 'invalid provider' });
    return null;
};

router.put('/keys/:provider', keyLimit, async (req, res) => {
    const id = byoId(req, res);
    if (!id) return;
    const k = req.body && req.body.apiKey;
    if (typeof k !== 'string' || k.length < 8 || k.length > 300 || /\s/.test(k)) return res.status(400).json({ error: 'apiKey must be 8..300 characters with no whitespace' });
    try {
        const keyLast4 = k.slice(-4);
        const u = await User.findByIdAndUpdate(req.user.userId, { $set: { [`ai.providers.${id}.keyEnc`]: secretBox.encrypt(k, req.user.userId, id), [`ai.providers.${id}.keyLast4`]: keyLast4 } }, { new: true });
        if (!u) return res.status(404).json({ error: 'not_found' });
        res.json({ provider: id, keySet: true, keyLast4 });
    } catch (err) { fail(res, new AiError(500, 'ai_error')); } // never pass the raw error: it could carry the key
});

router.delete('/keys/:provider', keyLimit, async (req, res) => {
    const id = byoId(req, res);
    if (!id) return;
    try {
        const u = await User.findByIdAndUpdate(req.user.userId, { $unset: { [`ai.providers.${id}.keyEnc`]: 1, [`ai.providers.${id}.keyLast4`]: 1 } }, { new: true });
        if (!u) return res.status(404).json({ error: 'not_found' });
        res.json({ provider: id, keySet: false, keyLast4: null });
    } catch (err) { fail(res, new AiError(500, 'ai_error')); }
});

// Models loaded in the user's LM Studio (GET {saved base URL}/models). Same loopback-only guard as completions.
router.get('/lmstudio/models', async (req, res) => {
    if (limited(req, res)) return;
    try { res.json({ models: await listLocalModels((await settingsFor(req.user.userId, 'lmstudio')).baseUrl) }); } catch (err) { fail(res, err); }
});

// The only place a test call is made on demand: one tiny real request with the saved key/model/base URL.
router.post('/test', async (req, res) => {
    const id = req.body && req.body.provider;
    if (typeof id !== 'string' || !(id === 'default' || PROVIDER_IDS.includes(id))) return res.status(400).json({ error: 'invalid provider' });
    if (limited(req, res)) return;
    try { res.json(await ai.testProvider(await settingsFor(req.user.userId, id))); } catch (err) { fail(res, err); }
});

module.exports = router;
