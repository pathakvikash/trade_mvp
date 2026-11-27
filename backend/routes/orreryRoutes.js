// Orrery app integration (public market data only, read-only). Off (503 / manifest 404) until ORRERY_APP_SECRET is set.
//   GET  /.well-known/orrery-app.json   manifest  (the SPA's Vercel project rewrites it here; see frontend/vercel.json)
//   POST /api/orrery/mcp                 MCP streamable HTTP, JSON responses, stateless, Bearer HS256 JWT
//   POST /api/orrery/sso                 60 s single-use handoff token -> normal Trade session for an EXISTING account
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const logger = require('../config/logger');
const { sessionFor } = require('../controllers/authController');
const { limitBy } = require('../middleware/rateLimit');
const auth = require('../services/orreryAuth');
const tools = require('../services/orreryTools');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const base = () => (process.env.ORRERY_BASE_URL || 'https://trade-mvp.vercel.app').replace(/\/+$/, '');

function manifest(req, res) {
    if (!auth.enabled()) return res.status(404).json({ error: 'not found' });
    const b = base();
    res.json({
        manifestVersion: 1,
        id: auth.settings().aud,
        name: 'Trade (Paperline)',
        icon: `${b}/favicon.svg`,
        baseUrl: b,
        description: 'Public crypto futures market data: candles, open interest and funding stats, estimated liquidation map, CVD, perpetual search and headlines.',
        goodFor: 'Look up crypto perpetual futures prices, charts, liquidation levels, CVD and market headlines.',
        mcp: { url: `${b}/api/orrery/mcp` },
        auth: 'orrery-jwt',
        sso: { path: '/sso' },
        capabilities: ['ohlc', 'timeseries', 'table', 'link'],
        deepLinks: { symbol: '/trade?symbol={symbol}' },
        permission: 'read',
    });
}

router.use((req, res, next) => (auth.enabled() ? next() : res.status(503).json({ error: 'orrery integration not configured' })));
router.use(limitBy({ limit: 600, windowMs: 60e3 })); // coarse per IP: Orrery's servers share a few IPs, the real limit is per user below

router.get('/mcp', (req, res) => res.set('Allow', 'POST').status(405).json({ error: 'method not allowed' }));

const NO_SSO = { success: false, message: 'Invalid or expired handoff token' };
router.post('/sso', limitBy({ limit: 10, windowMs: 60e3 }), async (req, res, next) => {
    try {
        let claims;
        try { claims = auth.verifyJwt(req.body && req.body.token, { purpose: 'sso' }); } catch { return res.status(401).json(NO_SSO); }
        if (!auth.consumeJti(claims.jti, claims.exp * 1000)) return res.status(401).json(NO_SSO); // replay
        const email = claims.sub.toLowerCase();
        const user = await User.findOne({ email });
        logger.info(JSON.stringify({ evt: 'orrery_sso', sub: email, account: !!user }));
        // No auto-create: the SPA sends the user to the normal login with the (verified) email prefilled.
        if (!user || user.lockedAt) return res.status(404).json({ success: false, code: 'NO_ACCOUNT', email });
        res.status(200).json(sessionFor(user));
    } catch (e) { next(e); }
});

// Everything below needs a valid service token. 401 never says why.
router.use((req, res, next) => {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    try {
        if (!m) throw new Error('missing');
        req.orrery = { sub: auth.verifyJwt(m[1]).sub };
        next();
    } catch (e) {
        res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: 'unauthorized' });
    }
});
router.use(limitBy({ limit: 60, windowMs: 60e3 }, (req) => req.orrery.sub)); // per user (token subject)

const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } });

router.post('/mcp', async (req, res) => {
    const msg = req.body;
    if (!msg || Array.isArray(msg) || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        return res.status(400).json(rpcErr(msg && msg.id, -32600, 'Invalid request'));
    }
    const { id, method, params } = msg;
    if (id === undefined) return res.status(202).end(); // notification (notifications/initialized, ...)
    const ok = (result) => res.json({ jsonrpc: '2.0', id, result });
    const log = (extra) => logger.info(JSON.stringify({ evt: 'orrery_call', sub: req.orrery.sub, method, ...extra }));

    if (method === 'initialize') {
        const want = params && params.protocolVersion;
        log({});
        return ok({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'paperline-trade', version: '1.0.0' } });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') { log({}); return ok({ tools: tools.listed() }); }
    if (method === 'tools/call') {
        const tool = params && typeof params.name === 'string' ? tools.find(params.name) : null;
        if (!tool) return res.json(rpcErr(id, -32602, 'Unknown tool'));
        log({ tool: tool.name });
        try {
            return ok(await tool.run((params.arguments && typeof params.arguments === 'object') ? params.arguments : {}));
        } catch (e) {
            // Validation errors are the model's to read; anything else stays generic (upstream detail is not for the client).
            if (!e.toolError) logger.warn(`orrery tool ${tool.name} failed: ${e.message}`);
            return ok({ isError: true, content: [{ type: 'text', text: e.toolError ? e.message : 'Market data is unavailable right now.' }] });
        }
    }
    res.json(rpcErr(id, -32601, 'Method not found'));
});

module.exports = router;
module.exports.manifest = manifest;
