// Yahoo Finance (unofficial, view-only) for the curated instruments. Never feeds trading, marks or fills.
//   quotes(category?)          -> { rows:[{symbol,name,category,exchange,currency,price,changePct,high,low,volume,marketOpen,asOf,stale?}], stale }
//   klines(symbol, interval, limit) -> { candles:[{time(s),open,high,low,close,volume}], stale }
// Quotes: batched /v7/finance/spark (chunks of 20), per-symbol /v8/finance/chart fallback (concurrency 3).
// /v7/quote is unauthorized upstream: not used. An explicit User-Agent is required (curl's default gets 429).
// Failures serve the last good answer with stale:true; none cached -> the error is thrown (routes answer 502).
const axios = require('axios');
const { cached, lastGood, remember, clear } = require('../cache');
const breaker = require('../breaker');
const validate = require('../validate');
const instruments = require('../instruments');

const BASE = process.env.YAHOO_REST || 'https://query1.finance.yahoo.com';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' };
const br = breaker('yahoo', { tripOnNetwork: true });
const enc = encodeURIComponent;

// client interval -> [Yahoo interval, Yahoo range, interval ms]. 4h is unsupported upstream.
const INTERVALS = {
    '1m': ['1m', '1d', 60e3], '5m': ['5m', '5d', 300e3], '15m': ['15m', '1mo', 900e3],
    '1h': ['60m', '3mo', 3600e3], '1d': ['1d', '2y', 86400e3],
};
const QUOTE_OPEN_MS = 60e3;
const QUOTE_CLOSED_MS = 15 * 60e3;
const MAX_STALE_MS = 24 * 3600e3; // ponytail: older last-good data is not served as "stale", it is an outage

const get = (path) => br.run(async () => (await axios.get(BASE + path, { timeout: 8000, headers: HEADERS })).data);
const num = (x) => (Number.isFinite(x) ? x : null);
// symbol -> regular session {start,end} (s) from the last answer, so cached rows can recompute marketOpen as time passes
const periods = new Map();
const openAt = (r, now) => { const p = periods.get(r.symbol); return p ? p.start <= now / 1000 && now / 1000 < p.end : r.marketOpen; };

function rowFrom(inst, meta, now) {
    const price = num(meta && meta.regularMarketPrice);
    if (price === null) return null;
    const prev = num(meta.chartPreviousClose);
    const p = meta.currentTradingPeriod && meta.currentTradingPeriod.regular;
    const open = p && Number.isFinite(p.start) && Number.isFinite(p.end) ? p.start <= now / 1000 && now / 1000 < p.end : null;
    if (open !== null) periods.set(inst.symbol, { start: p.start, end: p.end });
    return {
        symbol: inst.symbol, name: inst.name, category: inst.category, exchange: inst.exchange, currency: inst.currency,
        price,
        changePct: num(meta.regularMarketChangePercent) ?? (prev ? (price / prev - 1) * 100 : null),
        high: num(meta.regularMarketDayHigh), low: num(meta.regularMarketDayLow), volume: num(meta.regularMarketVolume),
        marketOpen: open,
        asOf: num(meta.regularMarketTime) !== null ? meta.regularMarketTime * 1000 : null,
    };
}

// run fn over items, at most n in flight
async function pool(items, n, fn) {
    const out = [];
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length) { const it = items[i++]; out.push(await fn(it)); }
    }));
    return out;
}

async function fetchQuotes(insts) {
    const now = Date.now();
    const rows = new Map();
    let lastErr = null;
    for (let i = 0; i < insts.length; i += 20) {
        const chunk = insts.slice(i, i + 20);
        try {
            const d = await get(`/v7/finance/spark?symbols=${chunk.map((x) => enc(x.yahoo)).join(',')}&range=1d&interval=1d`);
            const byYahoo = new Map(((d && d.spark && d.spark.result) || []).map((r) => [r.symbol, r]));
            for (const inst of chunk) {
                const meta = byYahoo.get(inst.yahoo)?.response?.[0]?.meta;
                const row = meta && rowFrom(inst, meta, now);
                if (row) rows.set(inst.symbol, row);
            }
        } catch (e) { lastErr = e; }
    }
    const missing = insts.filter((x) => !rows.has(x.symbol));
    if (missing.length && !(lastErr && lastErr.blocked)) { // an open breaker would reject every fallback call too
        await pool(missing, 3, async (inst) => {
            try {
                const d = await get(`/v8/finance/chart/${enc(inst.yahoo)}?range=1d&interval=1d`);
                const row = rowFrom(inst, d?.chart?.result?.[0]?.meta, now);
                if (row) rows.set(inst.symbol, row);
            } catch (e) { lastErr = e; }
        });
    }
    if (!rows.size) throw lastErr || new Error('yahoo returned no quotes');
    return insts.filter((x) => rows.has(x.symbol)).map((x) => rows.get(x.symbol)); // keep list order
}

const fresh = (e) => e && Date.now() - e.at < MAX_STALE_MS;

async function quotes(category) {
    const key = `yq:${category || 'all'}`;
    const last = lastGood.get(key);
    // closed markets barely move: reuse the last good answer for 15 min instead of 60 s, but only while every row is STILL closed
    // (a session may have opened since: marketOpen is recomputed from each row's trading period)
    const now = Date.now();
    if (last && last.value.every((r) => openAt(r, now) === false) && now - last.at < QUOTE_CLOSED_MS) return { rows: last.value.map((r) => ({ ...r, marketOpen: false })), stale: false };
    try {
        let rows = await cached(key, QUOTE_OPEN_MS, () => fetchQuotes(instruments.list(category)));
        // a partial spark answer (a later chunk got 429) must not shrink the list: fill the gaps from the last good rows, flagged stale
        const g = lastGood.get(key);
        if (fresh(g) && rows.length < g.value.length) {
            const have = new Map(rows.map((r) => [r.symbol, r]));
            const old = new Map(g.value.map((r) => [r.symbol, r]));
            rows = instruments.list(category).map((i) => have.get(i.symbol) || (old.has(i.symbol) && { ...old.get(i.symbol), stale: true })).filter(Boolean);
        } // ponytail: filled rows re-enter lastGood, so a symbol that keeps failing stays "stale" instead of expiring after 24 h
        remember(key, rows);
        return { rows, stale: false };
    } catch (e) {
        const g = lastGood.get(key);
        if (!fresh(g)) throw e;
        return { rows: g.value.map((r) => ({ ...r, stale: true })), stale: true };
    }
}

async function fetchKlines(inst, interval) {
    const [yi, range, ivMs] = INTERVALS[interval];
    const d = await get(`/v8/finance/chart/${enc(inst.yahoo)}?range=${range}&interval=${yi}`);
    const r = d?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0];
    if (!r || !q || !Array.isArray(r.timestamp)) throw new Error('yahoo returned no candles');
    // Yahoo leaves null rows (holidays, gaps): validate.candles drops non-finite OHLC
    const rows = r.timestamp.map((t, i) => ({ time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] }));
    const out = validate.candles(rows, ivMs, Date.now(), { allowStale: true }); // closed markets: last bar is old, still valid
    if (!out.length) throw new Error('yahoo returned no candles');
    return out;
}

async function klines(inst, interval, limit = 500) {
    if (!INTERVALS[interval]) throw new Error('unsupported interval');
    const key = `yk:${inst.symbol}:${interval}`;
    try {
        const c = await cached(key, interval === '1d' ? 30 * 60e3 : 60e3, () => fetchKlines(inst, interval));
        remember(key, c);
        return { candles: c.slice(-limit), stale: false };
    } catch (e) {
        const g = lastGood.get(key);
        if (!fresh(g)) throw e;
        return { candles: g.value.slice(-limit), stale: true };
    }
}

// No URLs, env values or upstream bodies: safe to expose.
const health = () => ({ name: 'yahoo', kind: 'quotes', ...br.state() });

module.exports = { quotes, klines, health, INTERVALS, _test: { reset() { br.reset(); clear(); periods.clear(); } } };
