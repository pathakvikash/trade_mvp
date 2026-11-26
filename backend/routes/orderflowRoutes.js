// Order Book Heatmap + Large Orders, mounted under /api/market/orderflow. Both views read the in-process collector
// (services/orderflow/collector.js): asking for a symbol is what starts its collection, so the limit is tighter than the
// 120/min the parent router already applies per IP.
const express = require('express');
const { limitBy } = require('../middleware/rateLimit');
const collector = require('../services/orderflow/collector');
const { isValidSymbol } = require('../services/futuresUtils');
const futuresRest = require('../services/futuresRest');

const router = express.Router();
router.use(limitBy({ limit: 40, windowMs: 60e3 })); // per IP; the UI polls two views every 5 s = 24/min

const view = (read) => async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    // any real USDT perp (the same list the pair picker uses); this check is what stops a client starting collection for junk
    let known = true;
    try { known = await futuresRest.isKnownSymbol(symbol); } catch (e) { /* list unavailable: regex-only, same as the rest of the page */ }
    if (!known) return res.status(404).json({ error: 'no_futures', message: 'No futures market for this symbol' });
    const body = collector[read](symbol, req.query || {});
    if (body.error === 'busy') return res.status(503).json({ error: 'collector_busy', degraded: true });
    if (body.source) res.set('X-Data-Source', body.source);
    return res.status(body.status === 'unavailable' ? 503 : 200).json(body.status === 'unavailable' ? { ...body, error: 'Order book data is unavailable from this server', degraded: true } : body);
};

router.get('/heatmap/:symbol', view('heatmap'));
router.get('/large/:symbol', view('large'));

module.exports = router;
