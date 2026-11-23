// Bitget USDT-M futures public REST (v2 mix market), no key. Analytics only: never prices, marks or fills.
// Symbols are the app's own (SKYAIUSDT). Rows come back in the shapes the controller validates and tags:
//   klines(symbol, interval, limit)  -> [{time(s), open, high, low, close, volume(base)}] ascending
//   ratio(symbol, period, limit)     -> [{ts(ms), ratio, longPct, shortPct}] ascending (account ratio)
//   funding(symbol, limit)           -> [{ts(ms), rate}] ascending
//   instruments()                    -> [{symbol, mult: 1}]
// Unsupported interval/period, unknown symbol (code 40034) and empty small-cap ratios (40054) return [].
// Errors (network, HTTP 4xx/5xx, other API codes) are thrown; API-level errors carry response.status 200 so a breaker does not trip.
const axios = require('axios');

const BASE = process.env.BITGET_REST || 'https://api.bitget.com/api/v2/mix/market';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
const EMPTY = new Set(['40034', '40054']);
const KL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' };
// verified 2026-11-24: 1d answers 40034 ("Parameter 1d does not exist"), so it is not offered
const RATIO = new Set(['5m', '15m', '30m', '1h', '4h']);
const num = (x) => parseFloat(x);
const pct = (x) => parseFloat((num(x) * 100).toFixed(4));

async function get(path, params) {
    let d;
    try {
        d = (await axios.get(BASE + path, { params: { productType: 'USDT-FUTURES', ...params }, timeout: 4000, headers: HEADERS })).data;
    } catch (e) {
        d = e.response && e.response.data;
        if (!(d && EMPTY.has(String(d.code)))) throw e;
    }
    const code = String(d && d.code);
    if (code === '00000') return d.data || [];
    if (EMPTY.has(code)) return [];
    throw Object.assign(new Error(`bitget ${code}: ${d && d.msg}`), { response: { status: 200, data: d } });
}

const klines = async (symbol, interval, limit) => {
    const granularity = KL[interval];
    if (!granularity) return [];
    const rows = await get('/candles', { symbol, granularity, limit: Math.min(1000, limit) });
    return rows.map((r) => ({ time: Math.floor(r[0] / 1000), open: num(r[1]), high: num(r[2]), low: num(r[3]), close: num(r[4]), volume: num(r[5]) }))
        .sort((a, b) => a.time - b.time).slice(-limit);
};

const ratio = async (symbol, period, limit) => {
    if (!RATIO.has(period)) return [];
    const rows = await get('/account-long-short', { symbol, period });
    return rows.map((r) => ({ ts: Number(r.ts), ratio: num(r.longShortAccountRatio), longPct: pct(r.longAccountRatio), shortPct: pct(r.shortAccountRatio) }))
        .sort((a, b) => a.ts - b.ts).slice(-limit);
};

const funding = async (symbol, limit) => {
    const rows = await get('/history-fund-rate', { symbol, pageSize: Math.min(100, limit) });
    return rows.map((r) => ({ ts: Number(r.fundingTime), rate: num(r.fundingRate) })).sort((a, b) => a.ts - b.ts);
};

const instruments = async () => (await get('/contracts', {})).filter((c) => c.symbolStatus === 'normal').map((c) => ({ symbol: c.symbol, mult: 1 }));

module.exports = { name: 'bitget', has: new Set(['klines', 'ratio', 'funding']), instruments, klines, ratio, funding };
