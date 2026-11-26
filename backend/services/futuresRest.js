// Binance USDS-M REST aggregations for the futures dashboard (all cached in memory). Thin facade: Binance first (providers/binance.js),
// then the marketData gateway (Bybit, Bitget, Gate, MEXC, spot) after a fallbackable Binance failure. The gateway is analytics only:
// markPrice and the overview's price/mark/ts columns never come from it (money path: tradeFill reads them).
const logger = require('../config/logger');
const { isValidSymbol, estimateLiqLevels, estimateLiqHeat, liqKeyLevels, LEV_MIX, LIQ_TIERS, MMR } = require('./futuresUtils');
const { cached, clear: clearCache } = require('./marketData/cache');
const { isBlocked, fallbackable } = require('./marketData/breaker');
const binance = require('./marketData/providers/binance');
const bybit = require('./marketData/providers/bybit');
const md = require('./marketData');

const get = binance.get;
const PERIODS = ['5m', '15m', '1h', '4h'];
const num = (x) => parseFloat(x);

// Overview OI column from Bybit's all-market tickers (the ONLY thing a third party may fill in an overview row).
// The overview never waits for it: refreshBybitOi() runs in the background and overviewFromWs reads the last map.
let bybitOiMap = new Map();
let bybitWarned = false;
function refreshBybitOi() {
    cached('bybitTickers', 30000, () => bybit.tickersOi()).then((m) => { bybitOiMap = m; bybitWarned = false; }, (e) => {
        if (!bybitWarned) logger.warn(`futuresRest: bybit tickers failed (${e.message})`);
        bybitWarned = true; // re-armed by the next success
    });
}

// The fstream WS feeds these (futuresService calls ingest*). Kept here, apart from futuresService's marks/hold/getMark,
// so the money path keeps its own subscription-based marks and there is no require cycle.
const liveTickers = new Map(); // symbol -> { c, o, h, l, q }
const liveMarks = new Map(); // symbol -> { markPrice, indexPrice, fundingRate, nextFundingTime, ts (receive time) }
function ingestTickers(arr) {
    if (!Array.isArray(arr)) return;
    const ts = Date.now();
    for (const t of arr) if (t && t.s) liveTickers.set(t.s, { c: num(t.c), o: num(t.o), h: num(t.h), l: num(t.l), q: num(t.q), ts });
}
// Delisted perps stop ticking: drop entries silent for 5 min before the fallbacks read these maps.
const LIVE_MAX_AGE_MS = 300e3;
function pruneLive() {
    const cutoff = Date.now() - LIVE_MAX_AGE_MS;
    for (const m of [liveTickers, liveMarks]) for (const [k, v] of m) if (v.ts < cutoff) m.delete(k);
}
function ingestMarks(arr) {
    if (!Array.isArray(arr)) return;
    const ts = Date.now();
    for (const m of arr) if (m && m.s) liveMarks.set(m.s, { markPrice: num(m.p), indexPrice: num(m.i), fundingRate: num(m.r), nextFundingTime: m.T, ts });
}

// JSON drops array props, so `source` rides along invisibly (routes read it for X-Data-Source).
const tag = (arr, source) => Object.defineProperty(arr, 'source', { value: source, enumerable: false });

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
    if (symbols) return symbols.has(symbol);
    // exchangeInfo never loaded: the !markPrice@arr stream carries every live perp (the ticker stream may skip quiet ones),
    // so a warm marks map beats the regex alone; cold/empty WS keeps the regex-only answer
    pruneLive();
    return liveMarks.size ? liveMarks.has(symbol) : true;
}

// [{symbol, base}] for the pair picker; throws when exchangeInfo has never loaded.
async function listSymbols() {
    await isKnownSymbol('BTCUSDT');
    if (!symbols) {
        // exchangeInfo blocked: the all-market ticker stream still names every live perp
        pruneLive();
        const live = [...liveTickers.keys()].filter((s) => s.endsWith('USDT') && isValidSymbol(s)).sort();
        if (!live.length) throw new Error('symbol list unavailable');
        return tag(live.map((symbol) => ({ symbol, base: symbol.replace(/USDT$/, '') })), 'ws');
    }
    return [...symbols].map(([symbol, base]) => ({ symbol, base: base || symbol.replace(/USDT$/, '') })).sort((a, b) => (a.symbol < b.symbol ? -1 : 1));
}

// ---- overview ----
const oiCache = new Map(); // symbol -> { oi, at }
const oiBusy = new Set(); // symbols with an OI call in flight (overlapping refreshes skip them)
async function refreshOpenInterest(syms) {
    if (binance.breaker.state().state !== 'closed') return; // do not spend the probe slot on 40 OI calls
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

// Blocked REST: rebuild the rows from the WS all-market streams. OI null here (overview fills it from Bybit), funding interval unknown (null; the UI
// shows 8h-based annualisation without a label). `ts` is the mark's receive time so tradeFill's age gate still rejects a stale row.
function overviewFromWs() {
    pruneLive();
    const rows = [];
    for (const [symbol, t] of liveTickers) {
        const m = liveMarks.get(symbol);
        if (!m || !isValidSymbol(symbol) || !(t.c > 0) || !(m.markPrice > 0)) continue;
        rows.push({
            symbol,
            lastPrice: t.c,
            priceChangePercent: t.o > 0 ? ((t.c - t.o) / t.o) * 100 : 0,
            high: t.h,
            low: t.l,
            quoteVolume: t.q,
            markPrice: m.markPrice,
            indexPrice: m.indexPrice,
            fundingRate: m.fundingRate,
            nextFundingTime: m.nextFundingTime,
            fundingIntervalHours: null,
            openInterestUsd: null,
            ts: m.ts,
        });
    }
    return rows.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 40);
}

const overviewRest = async () => {
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
};

const overview = () => cached('overview', 10000, async () => {
    try {
        return await overviewRest();
    } catch (e) {
        if (!fallbackable(e)) throw e;
        const rows = overviewFromWs();
        if (!rows.length) throw e; // WS not warmed up yet: 502 as before
        // Bybit OI from the last background refresh (null until the first lands); rows stay source 'ws'
        refreshBybitOi();
        rows.forEach((r) => { const v = bybitOiMap.get(r.symbol); r.openInterestUsd = v > 0 ? v : null; });
        return tag(rows, 'ws');
    }
});

// ---- stats ----
// [cap, args] per series: the same capability names the gateway chains use.
const statsJobs = (symbol, period) => ({
    openInterest: ['oiHist', [period, 200]],
    longShort: ['ratio', [period, 200]],
    topLongShort: ['topRatio', [period, 200]],
    takerBuySell: ['taker', [period, 200]],
    funding: ['funding', [100]],
});

const stats = (symbol, period) => cached(`stats:${symbol}:${period}`, 30000, async () => {
    const jobs = statsJobs(symbol, period);
    const keys = Object.keys(jobs);
    const res = await Promise.allSettled(keys.map((k) => binance[jobs[k][0]](symbol, ...jobs[k][1])));
    if (res.every((r) => r.status === 'rejected')) {
        // Binance unreachable: each series asks the other providers for itself (Binance is not retried), else 200 with empty
        // series so the page shows "no data". The body `source` is the first series' provider; `sources` lists them per series
        // only when they differ.
        if (res.every((r) => fallbackable(r.reason))) {
            const got = await Promise.all(keys.map((k) => md.rest(jobs[k][0], symbol, ...jobs[k][1]).catch(() => null)));
            const out = { symbol, period };
            const sources = {};
            keys.forEach((k, i) => {
                out[k] = got[i] ? [...got[i]] : [];
                if (out[k].length) sources[k] = got[i].source;
            });
            const names = [...new Set(Object.values(sources))];
            if (names.length) {
                out.source = sources[keys.find((k) => sources[k])];
                if (names.length > 1) out.sources = sources;
                return out;
            }
        }
        if (res.every((r) => isBlocked(r.reason))) return { symbol, period, ...Object.fromEntries(keys.map((k) => [k, []])), degraded: true, source: 'unavailable' };
        throw res[0].reason;
    }
    const out = { symbol, period };
    keys.forEach((k, i) => { out[k] = res[i].status === 'fulfilled' ? res[i].value : []; });
    return out;
});

// ---- liquidation map (estimate, see estimateLiqLevels) ----
const liqmapOf = (symbol, klines, oiHist) => {
    const price = klines[klines.length - 1].close;
    return {
        symbol, price, generatedAt: Date.now(), method: 'oi-delta-leverage-tiers', tiers: LIQ_TIERS.map(({ id, label }) => ({ id, label })),
        levels: estimateLiqLevels({ klines, oiHist, price }),
    };
};

// Binance first; on a fallbackable error the same estimate from the gateway's candles + OI (same provider for both), else the original error (route: 503 degraded).
const liqmap = (symbol) => cached(`liqmap:${symbol}`, 60000, async () => {
    try {
        const [klines, oi] = await Promise.all([binance.klines(symbol, '1h', 500), binance.oiHist(symbol, '1h', 500)]);
        // Binance answered fine but empty: not a transport failure, so no third-party fallback (an unknown symbol stays unknown)
        if (!klines.length) throw Object.assign(new Error('no klines'), { response: { status: 200 } });
        return liqmapOf(symbol, klines, oi.map(({ ts, oiUsd }) => ({ ts, oiUsd })));
    } catch (e) {
        if (!fallbackable(e)) throw e;
        const b = await md.pair(symbol, '1h', 500, 500).catch(() => null);
        if (!b) throw e;
        return tag(liqmapOf(symbol, b.candles, b.oiHist), b.source);
    }
});

// ---- predicted liquidation heatmap (see estimateLiqHeat) ----
// window = candles shown; as many again are loaded before it to seed levels opened earlier.
const HEAT_RANGES = {
    '12h': { iv: '5m', ms: 300e3, w: 144 },
    '24h': { iv: '5m', ms: 300e3, w: 288 },
    '3d': { iv: '15m', ms: 900e3, w: 288 },
    '1w': { iv: '1h', ms: 3600e3, w: 168 },
};

// liqheat entries are ~0.3 MB each: own small cache (insertion-ordered, oldest dropped).
const heatCache = new Map();
const liqheat = (symbol, range) => cached(`${symbol}:${range}`, 60000, async () => {
    const { iv, w } = HEAT_RANGES[range];
    let candles;
    let oiHist;
    let source;
    try {
        const [kl, oi] = await Promise.all([
            binance.klines(symbol, iv, 2 * w),
            binance.oiHistory(symbol, iv, 2 * w + 1),
        ]);
        candles = kl;
        oiHist = oi;
    } catch (e) {
        if (!fallbackable(e)) throw e;
        const b = await md.pair(symbol, iv, 2 * w, 2 * w + 1).catch(() => null);
        if (!b) throw e;
        ({ candles, oiHist, source } = b);
    }
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
    const out = {
        symbol, range, generatedAt: now, method: 'oi-delta-leverage-tiers', leverages: LEV_MIX.map((t) => t.lev), mmr: MMR, colMs: heat.colMs, t0: heat.t0,
        cols: heat.cols, rows: heat.rows, priceMin: heat.priceMin, priceStep: heat.priceStep, max: Math.round(heat.max),
        cells: Array.from(heat.cells, Math.round),
        candles: heat.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
        price,
        keyLevels: liqKeyLevels(heat.open, heat.priceMin, heat.priceStep, price),
        totals: { longUsd: Math.round(heat.totals.longUsd), shortUsd: Math.round(heat.totals.shortUsd) },
        outOfViewUsd: Math.round(heat.outOfViewUsd),
        ...(heat.cols < w && { partial: true }), // less history than the range asks for (new listing)
        largest: big && { price: big.price, usd: Math.round(big.usd), side: big.side },
    };
    return source ? tag(out, source) : out;
}, heatCache, 40);

// Single-symbol mark price for trade code: null on any failure or unknown symbol, never rejects. Cached 2s.
const markPrice = (symbol) => (isValidSymbol(symbol)
    ? cached(`mark:${symbol}`, 2000, async () => {
        try {
            const d = await get('/fapi/v1/premiumIndex', { symbol });
            const p = num(d && d.markPrice);
            if (!(p > 0)) throw new Error('bad mark price');
            return { markPrice: p, ts: Number(d.time) || Date.now() };
        } catch (e) {
            // Deliberate money-path fallback: the WS mark with its receive time. tradeFill still enforces <= 10 s.
            const m = fallbackable(e) && liveMarks.get(symbol);
            if (m && m.markPrice > 0) return { markPrice: m.markPrice, ts: m.ts };
            throw e;
        }
    }).catch(() => null)
    : Promise.resolve(null));

const klines = (symbol, interval, limit) => cached(`klines:${symbol}:${interval}:${limit}`, 10000, async () => {
    try {
        return await binance.klines(symbol, interval, limit);
    } catch (e) {
        if (!fallbackable(e)) throw e;
        // real futures candles first (also covers perp-only symbols); then spot; any failure or empty answer falls through
        return md.after(e, 'klines', symbol, interval, limit);
    }
});

module.exports = {
    PERIODS, HEAT_RANGES, overview, stats, liqmap, liqheat, klines, markPrice, isKnownSymbol, listSymbols,
    ingestTickers, ingestMarks, isBlocked,
    _test: {
        reset: () => { symbols = null; symbolsFresh = 0; symbolsP = null; clearCache(); heatCache.clear(); binance.breaker.reset(); md.reset(); liveTickers.clear(); liveMarks.clear(); bybitOiMap = new Map(); bybitWarned = false; },
        resetBreaker: () => binance.breaker.reset(),
    },
};
