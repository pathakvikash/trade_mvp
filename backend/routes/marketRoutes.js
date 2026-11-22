const express = require('express');
const axios = require('axios');
const router = express.Router();
const futuresService = require('../services/futuresService');
const futuresRest = require('../services/futuresRest');
const { isValidSymbol, INTERVALS } = require('../services/futuresUtils');
const { limitBy } = require('../middleware/rateLimit');

router.use(limitBy({ limit: 120, windowMs: 60e3 })); // per IP, everything under /api/market

// Proxy for historical market_chart data
router.get('/market_chart/:id', async (req, res) => {
    const { id } = req.params;
    const { days = '1' } = req.query;
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
            id
        )}/market_chart`;
        const response = await axios.get(url, {
            params: { vs_currency: 'usd', days },
            timeout: 10000,
        });
        res.json(response.data);
    } catch (err) {
        res.status(502).json({ message: 'Failed to fetch market chart', error: err.message });
    }
});

// Proxy for OHLC data
router.get('/ohlc/:id', async (req, res) => {
    const { id } = req.params;
    const { days = '1' } = req.query;
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
            id
        )}/ohlc`;
        const response = await axios.get(url, {
            params: { vs_currency: 'usd', days },
            timeout: 10000,
        });
        res.json(response.data);
    } catch (err) {
        res.status(502).json({ message: 'Failed to fetch OHLC', error: err.message });
    }
});

const noMarket = (res, symbol) => res.status(404).json({ error: `No perpetual futures market for ${symbol}` });

// Binance USDS-M futures klines (real candles for the Trade chart)
router.get('/futures/klines/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const interval = req.query.interval || '1m';
    const parsed = parseInt(req.query.limit, 10);
    const limit = Math.min(1000, Math.max(1, parsed > 0 ? parsed : 500)); // 0/NaN/negative -> default
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!INTERVALS.includes(interval)) return res.status(400).json({ error: 'invalid interval' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try {
        const rows = await futuresRest.klines(symbol, interval, limit); // cached 10s
        res.set('X-Data-Source', rows.source || 'binance-futures').json(rows);
    } catch (err) {
        const r = err.response;
        if (r && r.status === 400) {
            if (r.data && r.data.code === -1121) return res.status(404).json({ error: `No perpetual futures market for ${symbol}` });
            return res.status(400).json({ error: (r.data && r.data.msg) || 'Bad request to Binance' });
        }
        if (r && r.status === 451) {
            return res.status(502).json({ error: "Binance blocks this server's region (HTTP 451)" });
        }
        res.status(502).json({ error: 'Failed to fetch futures klines' });
    }
});

// Upstream failure -> 502 (451 = Binance region block, -1121 = unknown symbol -> 404)
// `noAlt`: no fallback source exists (liqmap/liqheat), so a blocked REST is 503 + degraded rather than a generic 502
function upstreamError(res, err, what, noAlt) {
    const r = err.response;
    if (noAlt && futuresRest.isBlocked(err)) return res.status(503).json({ error: 'Binance futures data is unavailable from this server', degraded: true });
    if (r && r.status === 451) return res.status(502).json({ error: "Binance blocks this server's region (HTTP 451)" });
    if (r && r.status === 400 && r.data && r.data.code === -1121) return res.status(404).json({ error: 'No perpetual futures market for this symbol' });
    res.status(502).json({ error: `Failed to fetch ${what}` });
}

router.get('/futures/overview', async (req, res) => {
    try {
        const rows = await futuresRest.overview();
        res.set('X-Data-Source', rows.source || 'binance-futures').json(rows);
    } catch (err) { upstreamError(res, err, 'futures overview'); }
});

router.get('/futures/stats/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const period = req.query.period || '1h';
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!futuresRest.PERIODS.includes(period)) return res.status(400).json({ error: 'invalid period' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try { res.json(await futuresRest.stats(symbol, period)); } catch (err) { upstreamError(res, err, 'futures stats'); }
});

router.get('/futures/liqmap/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try { res.json(await futuresRest.liqmap(symbol)); } catch (err) { upstreamError(res, err, 'liquidation map', true); }
});

// Predicted liquidation heatmap grid (estimate, see estimateLiqHeat)
router.get('/futures/liqheat/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const range = req.query.range || '24h';
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!Object.prototype.hasOwnProperty.call(futuresRest.HEAT_RANGES, range)) return res.status(400).json({ error: 'invalid range' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try { res.json(await futuresRest.liqheat(symbol, range)); } catch (err) { upstreamError(res, err, 'liquidation heatmap', true); }
});

// Tradable USDT perpetuals for the pair picker
router.get('/futures/symbols', async (req, res) => {
    try {
        const list = await futuresRest.listSymbols();
        res.set('X-Data-Source', list.source || 'binance-futures').set('Cache-Control', 'public, max-age=300').json(list);
    } catch (err) { res.status(502).json({ error: 'Failed to fetch symbol list' }); }
});

// Cross-symbol liquidation summary from the in-memory buffer (declared before /:symbol; cached 2s)
let liqSummary = { exp: 0 };
router.get('/futures/liquidations', (req, res) => {
    if (liqSummary.exp < Date.now()) liqSummary = { exp: Date.now() + 2000, body: futuresService.getLiquidationSummary() };
    res.json(liqSummary.body);
});

// Buffered realized liquidations (in memory since server start): { since, events }
router.get('/futures/liquidations/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    res.json(futuresService.getLiquidations(symbol));
});

module.exports = router;
