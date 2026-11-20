const express = require('express');
const auth = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimit');
const ai = require('../services/aiService');
const User = require('../models/User');
const { isValidSymbol } = require('../services/futuresUtils');
const { isKnownSymbol } = require('../services/futuresRest');

const router = express.Router();
router.use(auth);
router.use((req, res, next) => (req.user && req.user.userId ? next() : res.status(401).json({ success: false, message: 'Invalid token' })));

// One user lookup per request. Returns the raw stored ai.model; aiService decides whether it is in the allow-list.
const userModel = async (userId) => {
    const u = await User.findById(userId).select('ai.model').lean();
    return u && u.ai ? u.ai.model : null;
};

// Per-user limit shared by brief/ask/alerts-parse: 10 requests per rolling minute. Called AFTER input validation so
// invalid requests don't burn quota. Returns true when it already sent the 429.
const check = createLimiter({ limit: 10, windowMs: 60000 });
const limited = (req, res) => check(req.user.userId, res);

// Process-wide billed-call ceiling (AI_MAX_CALLS_PER_HOUR). brief/ask take their slot inside the service after market data
// is gathered; alerts/parse has no gather step so it checks here.
function overBudget(res) {
    const wait = ai.spend();
    if (!wait) return false;
    res.set('Retry-After', String(wait));
    res.status(429).json({ error: 'rate_limited' });
    return true;
}

const noMarket = (res, symbol) => res.status(404).json({ error: `No perpetual futures market for ${symbol}` });

const BRIEF_TTL_MS = 5 * 60 * 1000;
const briefCache = new Map(); // "symbol|model" -> { exp, body } | { exp, p } in flight; the model is part of the key
// ponytail: unbounded by symbol count but only valid symbols that succeeded are stored; cap if abused.

const fail = (res, err) => { if (err && err.retryAfter) res.set('Retry-After', String(err.retryAfter)); const m = ai.mapError(err); res.status(m.status).json(m.body); };

router.get('/status', async (req, res) => {
    const provider = await ai.provider();
    res.json({ configured: provider !== null, model: ai.resolveModel(await userModel(req.user.userId)), provider });
});

router.get('/brief/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!(await isKnownSymbol(symbol))) return noMarket(res, symbol);
    if (limited(req, res)) return;
    try {
        const model = ai.resolveModel(await userModel(req.user.userId));
        const key = `${symbol}|${model}`;
        let c = briefCache.get(key);
        if (!c || c.exp < Date.now()) {
            const p = ai.brief(symbol, model).then((brief) => ({ symbol, generatedAt: Date.now(), model, brief }));
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
    try { res.json({ answer: await ai.ask(symbol, q, await userModel(req.user.userId)) }); } catch (err) { fail(res, err); }
});

router.post('/alerts/parse', async (req, res) => {
    const t = req.body && typeof req.body.text === 'string' ? req.body.text.trim() : '';
    if (t.length < 3 || t.length > 300) return res.status(400).json({ error: 'text must be 3..300 chars' });
    if (limited(req, res) || overBudget(res)) return;
    try {
        const d = await ai.parseAlert(t, await userModel(req.user.userId));
        // validate the draft like a real alert so the client can POST it as-is
        const ok = d.parsed && Number.isFinite(d.value) && await isKnownSymbol(d.symbol);
        if (!ok) return res.status(422).json({ error: 'could_not_parse', reason: d.parsed ? 'model returned an invalid draft' : (d.reason || 'could not map the text to an alert') });
        res.json({ draft: { symbol: d.symbol, metric: d.metric, op: d.op, value: d.value, note: d.note.slice(0, 140) } });
    } catch (err) { fail(res, err); }
});

module.exports = router;
