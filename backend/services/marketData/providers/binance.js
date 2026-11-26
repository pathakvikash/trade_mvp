// Binance USDS-M REST (the primary source) + the Binance spot mirror. Code moved from futuresRest.js; behaviour unchanged.
// `get` is the ONLY door to fapi: it sits behind the shared breaker (418/403/451 -> open >= 5 min, 429 -> Retry-After or 60 s,
// one probe at a time; network errors and 5xx do NOT trip: they fall back for that call only, 400s pass through).
// Capability fns return the controller's shapes, ascending. Not used for any third-party data: this IS the first party.
const axios = require('axios');
const createBreaker = require('../breaker');
const { normalizeRestKline } = require('../../futuresUtils');

const BASE = process.env.BINANCE_FUTURES_REST || 'https://fapi.binance.com';
const SPOT_BASE = process.env.BINANCE_SPOT_REST || 'https://data-api.binance.vision';
const num = (x) => parseFloat(x);
const pct = (x) => parseFloat((num(x) * 100).toFixed(4)); // fraction -> percent
const byTs = (a, b) => a.ts - b.ts;

const breaker = createBreaker('Binance', { tripOnNetwork: false });
const get = (path, params) => breaker.run(async () => (await axios.get(BASE + path, { params, timeout: 10000 })).data);

// Spot mirror (klines only). No breaker: it is a different host and only used after fapi failed.
const spotKlines = (symbol, interval, limit) => axios.get(SPOT_BASE + '/api/v3/klines', { params: { symbol, interval, limit }, timeout: 10000 })
    .then((r) => r.data.map(normalizeRestKline));

// Raw spot rows (keeps field 9, taker buy base volume, which normalizeRestKline drops). Used by the CVD service only.
const spotKlinesRaw = (symbol, interval, limit) => axios.get(SPOT_BASE + '/api/v3/klines', { params: { symbol, interval, limit }, timeout: 10000 }).then((r) => r.data);

const klines = async (symbol, interval, limit) => (await get('/fapi/v1/klines', { symbol, interval, limit })).map(normalizeRestKline);

const ratioRows = (rows) => rows.map((r) => ({
    ts: r.timestamp, ratio: num(r.longShortRatio), longPct: pct(r.longAccount), shortPct: pct(r.shortAccount),
}));

const oiHist = async (symbol, period, limit) => (await get('/futures/data/openInterestHist', { symbol, period, limit }))
    .map((r) => ({ ts: r.timestamp, oi: num(r.sumOpenInterest), oiUsd: num(r.sumOpenInterestValue) })).sort(byTs);
const ratio = async (symbol, period, limit) => ratioRows(await get('/futures/data/globalLongShortAccountRatio', { symbol, period, limit })).sort(byTs);
const topRatio = async (symbol, period, limit) => ratioRows(await get('/futures/data/topLongShortPositionRatio', { symbol, period, limit })).sort(byTs);
const taker = async (symbol, period, limit) => (await get('/futures/data/takerlongshortRatio', { symbol, period, limit }))
    .map((r) => ({ ts: r.timestamp, ratio: num(r.buySellRatio), buyVol: num(r.buyVol), sellVol: num(r.sellVol) })).sort(byTs);
const funding = async (symbol, limit) => (await get('/fapi/v1/fundingRate', { symbol, limit }))
    .map((r) => ({ ts: r.fundingTime, rate: num(r.fundingRate) })).sort(byTs);

// openInterestHist allows 500 rows per call: page backwards with endTime (inclusive) until `count` rows. -> [{ts, oiUsd}]
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

module.exports = {
    name: 'binance', breaker, get, spotKlines, spotKlinesRaw, oiHistory,
    has: new Set(['klines', 'oiHist', 'ratio', 'topRatio', 'taker', 'funding']),
    klines, oiHist, ratio, topRatio, taker, funding,
};
