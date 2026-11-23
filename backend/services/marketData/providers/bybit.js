// Bybit v5 public REST (linear USDT perps, no key). Code moved from futuresRest.js; behaviour unchanged.
// Second source, used ONLY after Binance failed with fallbackable(e): one API covers klines, OI, account ratio and funding
// (and all-market tickers for the overview's OI column). Numbers differ from Binance (OI is Bybit-only, ratios are Bybit accounts),
// so every result is tagged 'bybit' by the controller.
// Breaker (shared module): no response/timeout, 403/418/429/451 or 5xx skips Bybit for 5 min; then one probe; success closes.
// API-level errors (retCode != 0) are thrown with response.status 200 so they never trip it. Unknown symbol (10001) = empty.
const axios = require('axios');
const createBreaker = require('../breaker');
const { normalizeRestKline } = require('../../futuresUtils');

const BYBIT_BASE = process.env.BYBIT_REST || 'https://api.bybit.com';
const BYBIT_KL = { '1m': '1', '3m': '3', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '2h': '120', '4h': '240', '6h': '360', '12h': '720', '1d': 'D', '1w': 'W' };
// OI history and account ratio share one period vocabulary; Bybit has no 2h/6h/12h there (unsupported -> empty series)
const BYBIT_PERIOD = { '5m': '5min', '15m': '15min', '30m': '30min', '1h': '1h', '4h': '4h', '1d': '1d' };
const BYBIT_STEP_MS = { '5min': 300e3, '15min': 900e3, '30min': 1800e3, '1h': 3600e3, '4h': 4 * 3600e3, '1d': 86400e3 };
const num = (x) => parseFloat(x);
const pct = (x) => parseFloat((num(x) * 100).toFixed(4));
const byTs = (a, b) => a.ts - b.ts;

const breaker = createBreaker('bybit', { tripOnNetwork: true, level: 'info' });
const withCap = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('bybit time cap')), ms); })]).finally(() => clearTimeout(t)); };

async function bybitGet(path, params) {
    const d = await breaker.run(async () => (await axios.get(BYBIT_BASE + path, { params: { category: 'linear', ...params }, timeout: 4000 })).data);
    // unknown symbol (retCode 10001 "Symbol Is Invalid") = unavailable, not a crash
    if (d.retCode === 10001 && /symbol/i.test(d.retMsg)) return { list: [] };
    if (d.retCode !== 0) throw Object.assign(new Error(`bybit ${d.retCode}: ${d.retMsg}`), { response: { status: 200, data: d } });
    return d.result;
}

// ascending, normalizeRestKline shape (Bybit returns newest first, strings)
async function klines(symbol, interval, limit) {
    const iv = BYBIT_KL[interval];
    if (!iv) return [];
    const { list } = await bybitGet('/v5/market/kline', { symbol, interval: iv, limit: Math.min(1000, limit) });
    return list.map(normalizeRestKline).sort((a, b) => a.time - b.time);
}

// USD price for a base-coin amount at ts: open of the candle starting at ts, else close of the last candle before it
function closeAt(candles) {
    return (ts) => {
        let lo = 0;
        let hi = candles.length - 1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; if (candles[m].time * 1000 <= ts) lo = m; else hi = m - 1; }
        const c = candles[lo];
        return c.time * 1000 >= ts ? c.open : c.close; // an OI snapshot stamped at a candle start was taken before that candle traded
    };
}

// [{ts, oi}] ascending, `count` rows max. 200 rows per call; pages are fetched concurrently: page k ends k*200 steps
// before the latest aligned slot (endTime is inclusive). ponytail: a hole in Bybit's history shifts older pages by the gap.
// Uses singleOpenInterest: Bybit's openInterest counts both sides (2x).
async function bybitOi(symbol, period, count) {
    const intervalTime = BYBIT_PERIOD[period];
    if (!intervalTime) return [];
    const step = BYBIT_STEP_MS[intervalTime];
    const head = Math.floor(Date.now() / step) * step;
    const pages = await Promise.all(Array.from({ length: Math.ceil(count / 200) }, (_, k) => bybitGet('/v5/market/open-interest', {
        symbol, intervalTime, limit: Math.min(200, count - k * 200), ...(k && { endTime: head - k * 200 * step }),
    })));
    const byTime = new Map();
    pages.forEach(({ list }) => list.forEach((r) => byTime.set(Number(r.timestamp), num(r.singleOpenInterest ?? r.openInterest))));
    return [...byTime].map(([ts, oi]) => ({ ts, oi })).sort(byTs).slice(-count);
}

// OI rows priced in USD with the Bybit candles of the same interval
const bybitOiUsd = (oi, candles) => { const px = candles.length ? closeAt(candles) : null; return px ? oi.map((r) => ({ ...r, oiUsd: r.oi * px(r.ts) })) : []; };

// [{ts, oi, oiUsd}] ascending
const oiHist = async (symbol, period, limit) => {
    const [oi, kl] = await withCap(Promise.all([bybitOi(symbol, period, limit), klines(symbol, period, limit)]), 8000);
    return bybitOiUsd(oi, kl).map((r) => ({ ts: r.ts, oi: r.oi, oiUsd: r.oiUsd }));
};

const ratio = async (symbol, period, limit) => {
    const rp = BYBIT_PERIOD[period];
    if (!rp) return [];
    const { list } = await bybitGet('/v5/market/account-ratio', { symbol, period: rp, limit });
    return list.filter((r) => num(r.sellRatio) > 0)
        .map((r) => ({ ts: Number(r.timestamp), ratio: num(r.buyRatio) / num(r.sellRatio), longPct: pct(r.buyRatio), shortPct: pct(r.sellRatio) })).sort(byTs);
};

const funding = async (symbol, limit) => (await bybitGet('/v5/market/funding/history', { symbol, limit }))
    .list.map((r) => ({ ts: Number(r.fundingRateTimestamp), rate: num(r.fundingRate) })).sort(byTs);

// Inputs for liqmap/liqheat: candles + OI rows priced at the candle close; null when either is empty (unknown symbol).
async function pair(symbol, iv, candleCount, oiCount) {
    const [candles, oi] = await withCap(Promise.all([klines(symbol, iv, candleCount), bybitOi(symbol, iv, oiCount)]), 8000);
    const oiRows = bybitOiUsd(oi, candles).map(({ ts, oiUsd }) => ({ ts, oiUsd }));
    return candles.length && oiRows.length ? { candles, oiHist: oiRows } : null;
}

// all-market tickers, one call: Map(symbol -> open interest USD, one side: Bybit's openInterestValue is 2x). Overview OI column only.
async function tickersOi() {
    return new Map((await bybitGet('/v5/market/tickers', {})).list.map((t) => [t.symbol, num(t.singleOpenInterestValue ?? t.openInterestValue)]));
}

// Listed linear USDT perps (health/diagnostics). Not used to gate calls: Bybit answers unknown symbols itself (10001).
const instruments = async () => (await bybitGet('/v5/market/instruments-info', { limit: 1000 })).list
    .filter((c) => c.status === 'Trading' && c.contractType === 'LinearPerpetual' && c.quoteCoin === 'USDT')
    .map((c) => ({ symbol: c.symbol, mult: 1 }));

module.exports = {
    name: 'bybit', breaker, consult: false,
    has: new Set(['klines', 'oiHist', 'ratio', 'funding']),
    instruments, klines, oiHist, ratio, funding, pair, tickersOi,
};
