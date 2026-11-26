// Order-book depth + recent trades for the order-flow collector. Binance USDS-M first (through the shared Binance breaker,
// so a blocked fapi costs no request), Bybit v5 linear when Binance fails with fallbackable(e). Analytics only, never a price
// for fills. Both return the same shape; `source` is what X-Data-Source reports ('binance-futures' | 'bybit').
//   fetchBook(symbol)   -> { source, ts, bids:[[price, qty]], asks:[[price, qty]] }  qty in base coin, levels as the exchange sent them
//   fetchTrades(symbol) -> { source, trades:[{ id, ts, price, qty, side }] }  side = TAKER side ('buy' | 'sell')
const axios = require('axios');
const binance = require('../marketData/providers/binance');
const createBreaker = require('../marketData/breaker');
const { fallbackable } = require('../marketData/breaker');

const BYBIT_BASE = process.env.BYBIT_REST || 'https://api.bybit.com';
const BINANCE_SRC = 'binance-futures';
const bybitBreaker = createBreaker('bybit-depth', { tripOnNetwork: true, level: 'info' });
const bybitGet = (path, params) => bybitBreaker.run(async () => {
    const d = (await axios.get(BYBIT_BASE + path, { params: { category: 'linear', ...params }, timeout: 4000 })).data;
    if (d.retCode !== 0) throw Object.assign(new Error(`bybit ${d.retCode}`), { response: { status: 200 } }); // API error: never trips the breaker
    return d.result;
});

const levels = (rows) => (Array.isArray(rows) ? rows : []).map(([p, q]) => [parseFloat(p), parseFloat(q)]).filter(([p, q]) => p > 0 && q > 0);

async function fetchBook(symbol) {
    try {
        const d = await binance.get('/fapi/v1/depth', { symbol, limit: 500 });
        return { source: BINANCE_SRC, ts: Number(d.T) || Number(d.E) || Date.now(), bids: levels(d.bids), asks: levels(d.asks) };
    } catch (e) {
        if (!fallbackable(e)) throw e;
        const r = await bybitGet('/v5/market/orderbook', { symbol, limit: 200 });
        return { source: 'bybit', ts: Number(r.ts) || Date.now(), bids: levels(r.b), asks: levels(r.a) };
    }
}

async function fetchTrades(symbol) {
    try {
        const rows = await binance.get('/fapi/v1/aggTrades', { symbol, limit: 500 });
        // m = buyer is the maker, so the aggressor sold
        return { source: BINANCE_SRC, trades: rows.map((t) => ({ id: `a${t.a}`, ts: Number(t.T), price: parseFloat(t.p), qty: parseFloat(t.q), side: t.m ? 'sell' : 'buy' })) };
    } catch (e) {
        if (!fallbackable(e)) throw e;
        const r = await bybitGet('/v5/market/recent-trade', { symbol, limit: 500 });
        return { source: 'bybit', trades: (r.list || []).map((t) => ({ id: `y${t.execId}`, ts: Number(t.time), price: parseFloat(t.price), qty: parseFloat(t.size), side: String(t.side).toLowerCase() === 'buy' ? 'buy' : 'sell' })) };
    }
}

module.exports = { fetchBook, fetchTrades, bybitBreaker };
