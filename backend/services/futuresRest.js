// Binance USDS-M REST aggregations for the futures dashboard (all cached in memory).
const axios = require('axios');
const logger = require('../config/logger');
const { isValidSymbol, normalizeRestKline, estimateLiqLevels, estimateLiqHeat, liqKeyLevels, LEV_MIX, MMR } = require('./futuresUtils');

const BASE = process.env.BINANCE_FUTURES_REST || 'https://fapi.binance.com';
const PERIODS = ['5m', '15m', '1h', '4h'];
const num = (x) => parseFloat(x);
const pct = (x) => parseFloat((num(x) * 100).toFixed(4)); // fraction -> percent
const get = (path, params) => axios.get(BASE + path, { params, timeout: 10000 }).then((r) => r.data);

// ponytail: per-process promise cache keyed by string; failures are evicted, capped at MAX_CACHE entries (oldest dropped).
const MAX_CACHE = 500;
const cache = new Map();
function cached(key, ttlMs, fn, store = cache, max = MAX_CACHE) {
    const c = store.get(key);
    if (c && c.exp > Date.now()) return c.p;
    const p = fn();
    for (const [k, v] of store) if (v.exp <= Date.now()) store.delete(k);
    if (store.size >= max) store.delete(store.keys().next().value);
    store.set(key, { p, exp: Date.now() + ttlMs });
    p.catch(() => { if (store.get(key)?.p === p) store.delete(key); });
    return p;
}

// ---- real symbols ----
// Tradable USDT perpetuals from exchangeInfo, cached 1h. A failed refresh keeps the last good set and retries
// after 1 min; with no good set yet we fall back to the regex only (isValidSymbol) and warn.
const SYMBOLS_TTL_MS = 3600e3;
const SYMBOLS_RETRY_MS = 60e3;
let symbols = null; // Map(symbol -> base asset) | null
let symbolsFresh = 0; // ms timestamp until which `symbols` / the failed attempt is not refetched
let symbolsP = null;
async function isKnownSymbol(symbol) {
    if (!isValidSymbol(symbol)) return false;
    if (Date.now() >= symbolsFresh) {
        symbolsP = symbolsP || get('/fapi/v1/exchangeInfo').then((d) => {
            symbols = new Map(d.symbols.filter((x) => x.status === 'TRADING' && x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT').map((x) => [x.symbol, x.baseAsset]));
            symbolsFresh = Date.now() + SYMBOLS_TTL_MS;
        }).catch((e) => {
            symbolsFresh = Date.now() + SYMBOLS_RETRY_MS;
            logger.warn(`futuresRest: exchangeInfo failed (${e.message}); ${symbols ? 'keeping last symbol set' : 'falling back to regex-only symbol check'}`);
        }).finally(() => { symbolsP = null; });
        await symbolsP;
    }
    return symbols ? symbols.has(symbol) : true;
}

// [{symbol, base}] for the pair picker; throws when exchangeInfo has never loaded.
async function listSymbols() {
    await isKnownSymbol('BTCUSDT');
    if (!symbols) throw new Error('symbol list unavailable');
    return [...symbols].map(([symbol, base]) => ({ symbol, base: base || symbol.replace(/USDT$/, '') })).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

// ---- overview ----
const oiCache = new Map(); // symbol -> { oi, at }
const oiBusy = new Set(); // symbols with an OI call in flight (overlapping refreshes skip them)
async function refreshOpenInterest(syms) {
    const stale = syms.filter((s) => !oiBusy.has(s) && (!oiCache.has(s) || Date.now() - oiCache.get(s).at > 60000));
    stale.forEach((s) => oiBusy.add(s));
    // concurrency 5; a failed symbol keeps its previous value (or null)
    const worker = async () => {
        for (let s = stale.pop(); s; s = stale.pop()) {
            try {
                const d = await get('/fapi/v1/openInterest', { symbol: s });
                oiCache.set(s, { oi: num(d.openInterest), at: Date.now() });
            } catch (e) { /* keep stale */ }
            oiBusy.delete(s);
        }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
}

// fundingInfo lists only symbols with non-default settings; everything else funds every 8h.
// A failed fetch is not cached (retried on the next overview) and never fails the overview.
const fundingIntervals = () => cached('fundingInfo', 3600e3, async () => new Map(
    (await get('/fapi/v1/fundingInfo')).map((r) => [r.symbol, num(r.fundingIntervalHours)]),
)).catch((e) => { logger.warn(`futuresRest: fundingInfo failed (${e.message}); assuming 8h`); return new Map(); });

const overview = () => cached('overview', 10000, async () => {
    const [tickers, premium, intervals] = await Promise.all([get('/fapi/v1/ticker/24hr'), get('/fapi/v1/premiumIndex'), fundingIntervals()]);
    const prem = new Map(premium.map((p) => [p.symbol, p]));
    const top = tickers
        .filter((t) => isValidSymbol(t.symbol) && prem.has(t.symbol))
        .sort((a, b) => num(b.quoteVolume) - num(a.quoteVolume))
        .slice(0, 40);
    // ponytail: wait at most 3s for the 40 OI calls (~10s cold through a proxy); stragglers finish in the
    // background and show up on the next poll, so openInterestUsd can be null on a cold start.
    let timer;
    await Promise.race([refreshOpenInterest(top.map((t) => t.symbol)), new Promise((r) => { timer = setTimeout(r, 3000); })]);
    clearTimeout(timer);
    return top.map((t) => {
        const p = prem.get(t.symbol);
        const oi = oiCache.get(t.symbol);
        const markPrice = num(p.markPrice);
        return {
            symbol: t.symbol,
            lastPrice: num(t.lastPrice),
            priceChangePercent: num(t.priceChangePercent),
            high: num(t.highPrice),
            low: num(t.lowPrice),
            quoteVolume: num(t.quoteVolume),
            markPrice,
            indexPrice: num(p.indexPrice),
            fundingRate: num(p.lastFundingRate),
            nextFundingTime: p.nextFundingTime,
            fundingIntervalHours: intervals.get(t.symbol) > 0 ? intervals.get(t.symbol) : 8,
            openInterestUsd: oi ? oi.oi * markPrice : null,
        };
    });
});

// ---- stats ----
const ratioRows = (rows) => rows.map((r) => ({
    ts: r.timestamp, ratio: num(r.longShortRatio), longPct: pct(r.longAccount), shortPct: pct(r.shortAccount),
}));
const byTs = (a, b) => a.ts - b.ts;

const stats = (symbol, period) => cached(`stats:${symbol}:${period}`, 30000, async () => {
    const q = { symbol, period, limit: 200 };
    const jobs = {
        openInterest: ['/futures/data/openInterestHist', q, (rows) => rows.map((r) => ({ ts: r.timestamp, oi: num(r.sumOpenInterest), oiUsd: num(r.sumOpenInterestValue) }))],
        longShort: ['/futures/data/globalLongShortAccountRatio', q, ratioRows],
        topLongShort: ['/futures/data/topLongShortPositionRatio', q, ratioRows],
        takerBuySell: ['/futures/data/takerlongshortRatio', q, (rows) => rows.map((r) => ({ ts: r.timestamp, ratio: num(r.buySellRatio), buyVol: num(r.buyVol), sellVol: num(r.sellVol) }))],
        funding: ['/fapi/v1/fundingRate', { symbol, limit: 100 }, (rows) => rows.map((r) => ({ ts: r.fundingTime, rate: num(r.fundingRate) }))],
    };
    const keys = Object.keys(jobs);
    const res = await Promise.allSettled(keys.map((k) => get(jobs[k][0], jobs[k][1])));
    if (res.every((r) => r.status === 'rejected')) throw res[0].reason;
    const out = { symbol, period };
    keys.forEach((k, i) => { out[k] = res[i].status === 'fulfilled' ? jobs[k][2](res[i].value).sort(byTs) : []; });
    return out;
});

// ---- liquidation map (estimate, see estimateLiqLevels) ----
const liqmap = (symbol) => cached(`liqmap:${symbol}`, 60000, async () => {
    const [kl, oi] = await Promise.all([
        get('/fapi/v1/klines', { symbol, interval: '1h', limit: 500 }),
        get('/futures/data/openInterestHist', { symbol, period: '1h', limit: 500 }),
    ]);
    const klines = kl.map(normalizeRestKline);
    if (!klines.length) throw new Error('no klines');
    const oiHist = oi.map((r) => ({ ts: r.timestamp, oiUsd: num(r.sumOpenInterestValue) })).sort(byTs);
    const price = klines[klines.length - 1].close;
    return {
        symbol, price, generatedAt: Date.now(), method: 'oi-delta-leverage-tiers',
        levels: estimateLiqLevels({ klines, oiHist, price }),
    };
});

// ---- predicted liquidation heatmap (see estimateLiqHeat) ----
// window = candles shown; as many again are loaded before it to seed levels opened earlier.
const HEAT_RANGES = {
    '12h': { iv: '5m', ms: 300e3, w: 144 },
    '24h': { iv: '5m', ms: 300e3, w: 288 },
    '3d': { iv: '15m', ms: 900e3, w: 288 },
    '1w': { iv: '1h', ms: 3600e3, w: 168 },
};

// openInterestHist allows 500 rows per call: page backwards with endTime (inclusive) until `count` rows.
async function oiHistory(symbol, period, count) {
    let rows = [];
    for (let end; rows.length < count;) {
        const limit = Math.min(500, count - rows.length);
        const r = await get('/futures/data/openInterestHist', { symbol, period, limit, ...(end && { endTime: end }) });
        rows = r.concat(rows);
        if (r.length < limit) break;
        end = r[0].timestamp - 1;
    }
    return rows.map((r) => ({ ts: r.timestamp, oiUsd: num(r.sumOpenInterestValue) })).sort(byTs);
}

// liqheat entries are ~0.3 MB each: own small cache (insertion-ordered, oldest dropped).
const heatCache = new Map();
const liqheat = (symbol, range) => cached(`${symbol}:${range}`, 60000, async () => {
    const { iv, w } = HEAT_RANGES[range];
    const [kl, oiHist] = await Promise.all([
        get('/fapi/v1/klines', { symbol, interval: iv, limit: 2 * w }),
        oiHistory(symbol, iv, 2 * w + 1),
    ]);
    const candles = kl.map(normalizeRestKline);
    if (!candles.length) throw new Error('no klines');
    const now = Date.now();
    const from = candles[Math.max(0, candles.length - w)].time * 1000;
    const heat = estimateLiqHeat({ candles, oiHist, now, from });
    if (!heat.cols) throw new Error('no candles');
    const price = heat.candles[heat.cols - 1].close;
    let big = null; // largest single (smoothed) bucket in the last column
    for (const side of ['long', 'short']) {
        heat.open[side].forEach((usd, b) => { if (usd > 0 && (!big || usd > big.usd)) big = { price: heat.priceMin + (b + 0.5) * heat.priceStep, usd, side }; });
    }
    return {
        symbol, range, generatedAt: now, method: 'oi-delta-leverage-tiers', leverages: LEV_MIX.map((t) => t.lev), mmr: MMR, colMs: heat.colMs, t0: heat.t0,
        cols: heat.cols, rows: heat.rows, priceMin: heat.priceMin, priceStep: heat.priceStep, max: Math.round(heat.max),
        cells: Array.from(heat.cells, Math.round),
        candles: heat.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
        price,
        keyLevels: liqKeyLevels(heat.open, heat.priceMin, heat.priceStep, price),
        totals: { longUsd: Math.round(heat.totals.longUsd), shortUsd: Math.round(heat.totals.shortUsd) },
        outOfViewUsd: Math.round(heat.outOfViewUsd),
        largest: big && { price: big.price, usd: Math.round(big.usd), side: big.side },
    };
}, heatCache, 40);

// Single-symbol mark price for trade code: null on any failure or unknown symbol, never rejects. Cached 2s.
const markPrice = (symbol) => (isValidSymbol(symbol)
    ? cached(`mark:${symbol}`, 2000, async () => {
        const d = await get('/fapi/v1/premiumIndex', { symbol });
        const p = num(d && d.markPrice);
        if (!(p > 0)) throw new Error('bad mark price');
        return { markPrice: p, ts: Number(d.time) || Date.now() };
    }).catch(() => null)
    : Promise.resolve(null));

const klines = (symbol, interval, limit) => cached(`klines:${symbol}:${interval}:${limit}`, 10000,
    async () => (await get('/fapi/v1/klines', { symbol, interval, limit })).map(normalizeRestKline));

module.exports = {
    PERIODS, HEAT_RANGES, overview, stats, liqmap, liqheat, klines, markPrice, isKnownSymbol, listSymbols,
    _test: { reset: () => { symbols = null; symbolsFresh = 0; symbolsP = null; cache.clear(); heatCache.clear(); } },
};
