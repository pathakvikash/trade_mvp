// Gate.io USDT futures public REST (api/v4/futures/usdt), no key. Analytics only: never prices, marks or fills.
// SKYAIUSDT <-> SKYAI_USDT. Gate sizes are CONTRACTS; mult = base coin per contract (quanto_multiplier, from instruments()).
// Pass it as the LAST argument of every size-bearing call, e.g. klines(sym, iv, limit, meta.mult). Never guess 1:
// without a mult>0, klines and taker return [] and oiHist omits `oi` (oiUsd needs no mult).
//   klines(symbol, interval, limit, mult)  -> [{time(s), open, high, low, close, volume(base)}] ascending
//   oiHist(symbol, period, limit, mult)    -> [{ts(ms), oi?(base), oiUsd}]  (oiUsd = open_interest_usd as given)
//   ratio(symbol, period, limit)           -> [{ts, ratio, longPct, shortPct}]  accounts
//   topRatio(symbol, period, limit)        -> [{ts, ratio, longPct, shortPct}]  top-trader position size
//   taker(symbol, period, limit, mult)     -> [{ts, ratio, buyVol, sellVol}] (base)
//   funding(symbol, limit)                 -> [{ts, rate}]
//   instruments()                          -> [{symbol, mult}]
//   contract(symbol)                       -> {symbol, mult} | null
// contract_stats serves 5m/15m/1h/4h (verified), up to 1000 rows; its last bucket is still forming (taker 0): skipped.
// Unknown contract (HTTP 400 CONTRACT_NOT_FOUND) and unsupported intervals return []; other errors are thrown.
const axios = require('axios');
const { cached } = require('../cache');

const BASE = process.env.GATE_REST || 'https://api.gateio.ws/api/v4/futures/usdt';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
const KL = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const STATS = new Set(['5m', '15m', '1h', '4h']);
const num = (x) => parseFloat(x);
const pct = (x) => parseFloat((x * 100).toFixed(4));
const contract = (s) => s.replace(/USDT$/, '_USDT');
const hasMult = (m) => Number.isFinite(m) && m > 0;

async function get(path, params, timeout = 4000) {
    try {
        return (await axios.get(BASE + path, { params, timeout, headers: HEADERS })).data;
    } catch (e) {
        if (e.response && e.response.data && e.response.data.label === 'CONTRACT_NOT_FOUND') return [];
        throw e;
    }
}

const klines = async (symbol, interval, limit, mult) => {
    if (!KL.has(interval) || !hasMult(mult)) return [];
    const rows = await get('/candlesticks', { contract: contract(symbol), interval, limit: Math.min(2000, limit) });
    return rows.map((r) => ({ time: Number(r.t), open: num(r.o), high: num(r.h), low: num(r.l), close: num(r.c), volume: num(r.v) * mult }))
        .sort((a, b) => a.time - b.time).slice(-limit);
};

// ascending, one row per `time` (a repeated bucket keeps the last)
async function stats(symbol, period, limit) {
    if (!STATS.has(period)) return [];
    // oiHist/ratio/topRatio/taker of one chart load all hit this endpoint: one request, shared for 5 s
    const n = Math.min(1000, limit);
    const rows = await cached(`gate:stats:${symbol}:${period}:${n}`, 5000, () => get('/contract_stats', { contract: contract(symbol), interval: period, limit: n }));
    return [...new Map(rows.map((r) => [r.time, r])).values()].sort((a, b) => a.time - b.time);
}

const oiHist = async (symbol, period, limit, mult) => (await stats(symbol, period, limit))
    .map((r) => ({ ts: r.time * 1000, ...(hasMult(mult) && { oi: r.open_interest * mult }), oiUsd: r.open_interest_usd }));

const split = (ts, ratio, a, b) => (a + b > 0 ? { ts, ratio, longPct: pct(a / (a + b)), shortPct: pct(b / (a + b)) } : null);

const ratio = async (symbol, period, limit) => (await stats(symbol, period, limit))
    .map((r) => split(r.time * 1000, r.lsr_account, r.long_users, r.short_users)).filter(Boolean);

const topRatio = async (symbol, period, limit) => (await stats(symbol, period, limit))
    .map((r) => split(r.time * 1000, r.top_lsr_size, r.top_long_size, r.top_short_size)).filter(Boolean);

const taker = async (symbol, period, limit, mult) => (hasMult(mult)
    ? (await stats(symbol, period, limit))
        .filter((r) => r.long_taker_size + r.short_taker_size > 0)
        .map((r) => ({ ts: r.time * 1000, ratio: r.lsr_taker, buyVol: r.long_taker_size * mult, sellVol: r.short_taker_size * mult }))
    : []);

const funding = async (symbol, limit) => (await get('/funding_rate', { contract: contract(symbol), limit: Math.min(1000, limit) }))
    .map((r) => ({ ts: Number(r.t) * 1000, rate: num(r.r) })).sort((a, b) => a.ts - b.ts);

const instruments = async ({ timeout } = {}) => (await get('/contracts', {}, timeout))
    .filter((c) => c.status === 'trading' && !c.in_delisting && /_USDT$/.test(c.name))
    .map((c) => ({ symbol: c.name.replace('_', ''), mult: num(c.quanto_multiplier) }));

// One contract (used by the registry when the full list never loaded, to learn mult). null = not listed/not trading.
const contractMeta = async (symbol) => {
    const c = await get(`/contracts/${contract(symbol)}`, {});
    return c && c.name && c.status === 'trading' && !c.in_delisting ? { symbol, mult: num(c.quanto_multiplier) } : null;
};

module.exports = {
    name: 'gate', needsMult: true, contract: contractMeta, has: new Set(['klines', 'oiHist', 'ratio', 'topRatio', 'taker', 'funding']),
    instruments, klines, oiHist, ratio, topRatio, taker, funding,
};
