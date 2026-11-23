// Shared by routes/aiRoutes.js and routes/agentRoutes.js: the user's AI settings and the per-user request limits.
const { createLimiter } = require('../../middleware/rateLimit');
const User = require('../../models/User');

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

// Per-user limit shared by brief/ask/alerts-parse/agent chat: 10 requests per rolling minute. Called AFTER input
// validation so invalid requests don't burn quota. Returns true when it already sent the 429.
const check = createLimiter({ limit: 10, windowMs: 60000 });
const limited = (req, res) => check(req.user.userId, res);

// Agent chat on the server's own credentials (`default` provider) only: 60 per user per rolling 24 h, on top of the
// process hourly budget. Bring-your-own-key calls are billed to the user, so they are not capped here.
const checkDaily = createLimiter({ limit: 60, windowMs: 24 * 3600e3 });
const dailyLimited = (req, res, settings) => settings.provider === 'default' && checkDaily(req.user.userId, res);

module.exports = { settingsFor, limited, dailyLimited };
