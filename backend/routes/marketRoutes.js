const express = require('express');
const axios = require('axios');
const router = express.Router();
const futuresService = require('../services/futuresService');
const futuresRest = require('../services/futuresRest');
const { isValidSymbol, INTERVALS } = require('../services/futuresUtils');
const { limitBy } = require('../middleware/rateLimit');
const instruments = require('../services/marketData/instruments');
const yahoo = require('../services/marketData/providers/yahoo');
const cvdService = require('../services/cvd');
const maxPain = require('../services/maxPain');

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

// objects (stats, liqmap, liqheat) carry `source` (own property or tag()) -> X-Data-Source, same as the array routes
const sendObj = (res, d) => { if (d.source) res.set('X-Data-Source', d.source); res.json(d); };

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
    try { sendObj(res, await futuresRest.stats(symbol, period)); } catch (err) { upstreamError(res, err, 'futures stats'); }
});

router.get('/futures/liqmap/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try { sendObj(res, await futuresRest.liqmap(symbol)); } catch (err) { upstreamError(res, err, 'liquidation map', true); }
});

// Predicted liquidation heatmap grid (estimate, see estimateLiqHeat)
router.get('/futures/liqheat/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const range = req.query.range || '24h';
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!Object.prototype.hasOwnProperty.call(futuresRest.HEAT_RANGES, range)) return res.status(400).json({ error: 'invalid range' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try { sendObj(res, await futuresRest.liqheat(symbol, range)); } catch (err) { upstreamError(res, err, 'liquidation heatmap', true); }
});

// Cumulative volume delta from real Binance taker volume: futures + spot series. ?interval=1m..1d (or the older ?range=).
// 200 with available:false (futures) / spot.available:false when a source is unreachable; nothing is approximated.
router.get('/futures/cvd/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const range = req.query.range || '24h';
    const interval = req.query.interval;
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (interval !== undefined && !has(cvdService.CVD_INTERVALS, interval)) return res.status(400).json({ error: 'invalid interval' });
    if (!has(cvdService.CVD_RANGES, range)) return res.status(400).json({ error: 'invalid range' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try { sendObj(res, await cvdService.cvd(symbol, range, interval)); } catch (err) { upstreamError(res, err, 'CVD'); }
});

// Large recent futures trades (aggTrades) + taker flow of the last 60 s. ?min= USD threshold (10K/50K/100K/500K/1M).
router.get('/futures/cvd/:symbol/trades', async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const min = req.query.min === undefined ? cvdService.TRADE_MINS[0] : Number(req.query.min);
    if (!isValidSymbol(symbol)) return res.status(400).json({ error: 'invalid symbol' });
    if (!cvdService.TRADE_MINS.includes(min)) return res.status(400).json({ error: 'invalid min' });
    if (!(await futuresRest.isKnownSymbol(symbol))) return noMarket(res, symbol);
    try { sendObj(res, await cvdService.trades(symbol, min)); } catch (err) { upstreamError(res, err, 'CVD trades'); }
});

// Tradable USDT perpetuals for the pair picker
router.get('/futures/symbols', async (req, res) => {
    try {
        const list = await futuresRest.listSymbols();
        res.set('X-Data-Source', list.source || 'binance-futures').set('Cache-Control', 'public, max-age=300').json(list);
    } catch (err) { res.status(502).json({ error: 'Failed to fetch symbol list' }); }
});

// Multi-coin max-pain board (top N perps by volume, N <= 30), 60 s cache + stale-while-revalidate. Own 10/min limit on top of the router's.
router.get('/futures/maxpain', limitBy({ limit: 10, windowMs: 60e3 }), async (req, res) => {
    const win = req.query.window || '24h';
    const top = req.query.top === undefined ? maxPain.DEFAULT_TOP : parseInt(req.query.top, 10);
    if (!Object.prototype.hasOwnProperty.call(futuresRest.HEAT_RANGES, win)) return res.status(400).json({ error: 'invalid window' });
    if (!(top >= 1 && top <= maxPain.MAX_TOP)) return res.status(400).json({ error: `top must be 1-${maxPain.MAX_TOP}` });
    try { res.json(await maxPain.maxPain(win, top)); } catch (err) { upstreamError(res, err, 'max pain', true); }
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

// ---- Curated view-only markets (Yahoo): stocks, indices, commodities, currencies. Never trading symbols. ----
// Clients send display symbols only (NIFTY50, GOLD, RELIANCE); the Yahoo ticker never leaves the server.
const DISCLAIMER = 'Unofficial Yahoo Finance data, may be delayed (NSE quotes can lag about 15 min), view only, not investment advice.';
const yahooSend = (res, body) => res.set('X-Data-Source', 'yahoo').json({ disclaimer: DISCLAIMER, ...body });
const yahooDown = (res) => res.status(502).json({ error: 'Market data unavailable' });

// forced: category fixed by the route (back-compat /stocks/*), else taken from ?category=
const quotesRoute = (forced) => async (req, res) => {
    const category = forced || req.query.category;
    if (category !== undefined && !instruments.CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid category' });
    try {
        const { rows } = await yahoo.quotes(category);
        yahooSend(res, { rows });
    } catch (err) { yahooDown(res); }
};

const klinesRoute = (forced) => async (req, res) => {
    const inst = instruments.find(req.params.symbol);
    if (!inst && !instruments.SYMBOL_RE.test(String(req.params.symbol).toUpperCase())) return res.status(400).json({ error: 'invalid symbol' });
    if (!inst || (forced && inst.category !== forced)) return res.status(404).json({ error: 'Unknown symbol' });
    const interval = req.query.interval || '1d';
    if (!Object.prototype.hasOwnProperty.call(yahoo.INTERVALS, interval)) return res.status(400).json({ error: 'invalid interval' });
    const parsed = parseInt(req.query.limit, 10);
    const limit = Math.min(1000, Math.max(1, parsed > 0 ? parsed : 500));
    try {
        const { candles, stale } = await yahoo.klines(inst, interval, limit);
        yahooSend(res, { symbol: inst.symbol, name: inst.name, category: inst.category, exchange: inst.exchange, currency: inst.currency, interval, candles, ...(stale && { stale: true }) });
    } catch (err) { yahooDown(res); }
};

router.get('/stocks/quotes', quotesRoute('stock'));
router.get('/stocks/klines/:symbol', klinesRoute('stock'));
router.get('/instruments/quotes', quotesRoute());
router.get('/instruments/klines/:symbol', klinesRoute());

// Health of the data sources. The gateway module may be absent or throw: never take the route down for it.
router.get('/providers', (req, res) => {
    let providers = [yahoo.health()];
    try {
        const h = require('../services/marketData').health();
        providers = [...(Array.isArray(h) ? h : Array.isArray(h && h.providers) ? h.providers : h ? [h] : []), ...providers];
    } catch (err) { /* yahoo only */ }
    res.json({ providers });
});

router.use('/orderflow', require('./orderflowRoutes')); // order book heatmap + large orders (in-process collector)

module.exports = router;
