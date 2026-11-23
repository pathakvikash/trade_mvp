// MEXC futures public REST (contract.mexc.com/api/v1/contract), no key. Analytics only: never prices, marks or fills.
// SKYAIUSDT <-> SKYAI_USDT. MEXC volumes are CONTRACTS; mult = contractSize (base coin per contract, from instruments()).
// Pass it as the LAST argument: klines(sym, iv, limit, meta.mult). Never guess 1: without a mult>0 klines returns [].
//   klines(symbol, interval, limit, mult) -> [{time(s), open, high, low, close, volume(base)}] ascending, at most `limit`
//   funding(symbol, limit)                -> [{ts(ms), rate}] ascending
//   instruments()                         -> [{symbol, mult}]
//   contract(symbol)                      -> {symbol, mult} | null
// No oiHist/ratio (the open-interest endpoint is Akamai-denied). Unknown contract (code 1001) and unsupported intervals
// return []; other failures throw (API-level ones with response.status 200 so a breaker does not trip, except code 510/429 throttling -> 429).
const axios = require('axios');

const BASE = process.env.MEXC_REST || 'https://contract.mexc.com/api/v1/contract';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
const KL = { '1m': 'Min1', '5m': 'Min5', '15m': 'Min15', '1h': 'Min60', '4h': 'Hour4', '1d': 'Day1' };
const IV_S = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const num = (x) => parseFloat(x);
const contract = (s) => s.replace(/USDT$/, '_USDT');

// data, or null for an unknown contract
async function get(path, params, timeout = 4000) {
    const d = (await axios.get(BASE + path, { params, timeout, headers: HEADERS })).data;
    if (d && d.success) return d.data;
    if (d && d.code === 1001) return null;
    // HTTP-200 throttling (510 too frequent / 429) is a rate limit: report 429 so the breaker trips
    const throttled = d && (d.code === 510 || d.code === 429);
    throw Object.assign(new Error(`mexc ${d && d.code}: ${d && d.message}`), { response: { status: throttled ? 429 : 200, data: d } });
}

const klines = async (symbol, interval, limit, mult) => {
    const iv = KL[interval];
    if (!iv || !(mult > 0)) return [];
    const end = Math.floor(Date.now() / 1000);
    const d = await get(`/kline/${contract(symbol)}`, { interval: iv, start: end - limit * IV_S[interval], end });
    if (!d || !Array.isArray(d.time)) return [];
    return d.time.map((t, i) => ({ time: Number(t), open: num(d.open[i]), high: num(d.high[i]), low: num(d.low[i]), close: num(d.close[i]), volume: num(d.vol[i]) * mult }))
        .sort((a, b) => a.time - b.time).slice(-limit);
};

const funding = async (symbol, limit) => {
    const d = await get('/funding_rate/history', { symbol: contract(symbol), page_size: Math.min(100, limit) });
    return ((d && d.resultList) || []).map((r) => ({ ts: Number(r.settleTime), rate: num(r.fundingRate) })).sort((a, b) => a.ts - b.ts);
};

const instruments = async ({ timeout } = {}) => ((await get('/detail', {}, timeout)) || [])
    .filter((c) => c.state === 0 && c.quoteCoin === 'USDT')
    .map((c) => ({ symbol: c.symbol.replace('_', ''), mult: num(c.contractSize) }));

// One contract (registry fallback when the full list never loaded). null = unknown or not enabled.
const contractMeta = async (symbol) => {
    const d = await get('/detail', { symbol: contract(symbol) });
    const c = Array.isArray(d) ? d[0] : d;
    return c && c.state === 0 && c.quoteCoin === 'USDT' ? { symbol, mult: num(c.contractSize) } : null;
};

module.exports = { name: 'mexc', needsMult: true, contract: contractMeta, has: new Set(['klines', 'funding']), instruments, klines, funding };
