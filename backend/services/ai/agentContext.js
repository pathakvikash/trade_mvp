// Builds the DATA block the agent sees. Everything is rebuilt from allow-listed fields (never spread an upstream object),
// numbers go through num(), and no upstream free text is copied (names come from the static instruments list), so a
// hostile Yahoo longName or exchange field cannot reach the prompt. Every block degrades on its own.
const futuresRest = require('../futuresRest');
const futuresService = require('../futuresService');
const { loadPortfolio, nearestSide, trendOf } = require('../aiService');
const instruments = require('../marketData/instruments');
const { CAPS, DEFAULTS, MIN_NOTIONAL_USD } = require('../bot/riskGuard');
const { INTERVALS } = require('../futuresUtils');

const MAX_CHARS = 24000;
const MAX_CHARS_LOCAL = 9000;
const CACHE_MS = 30e3;
const MAX_CACHE = 100;
const MACRO = ['NIFTY50', 'BANKNIFTY', 'GOLD', 'CRUDEOIL', 'USDINR'];
const PAGES = ['trade', 'derivatives', 'liquidation', 'markets', 'dashboard'];
const WINDOWS = { '1h': 3600e3, '4h': 4 * 3600e3, '24h': 24 * 3600e3 };
const PERP_RE = /^[A-Z0-9]{2,20}$/;
const TAG_RE = /^[a-z0-9-]{1,24}$/;
const KEY_RE = /^[A-Za-z0-9]{1,24}$/;

// bot hard caps (static, from riskGuard): the model plans inside them; the server re-checks every plan number
const CAPS_BLOCK = { source: 'static', maxLeverage: CAPS.MAX_LEVERAGE, maxSizeUsd: CAPS.MAX_SIZE_USD, minNotionalUsd: MIN_NOTIONAL_USD, takerFeeBps: 5, defaultDailyLossUsd: DEFAULTS.dailyLossUsd, sizeIsNotional: true };

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const tagOf = (o, dflt) => (o && typeof o.source === 'string' && TAG_RE.test(o.source) ? o.source : dflt);
const arr = (a) => (Array.isArray(a) ? a : []);

const candleRows = (a) => arr(a).map((c) => ({ time: num(c && c.time), open: num(c && c.open), high: num(c && c.high), low: num(c && c.low), close: num(c && c.close), volume: num(c && c.volume) }))
    .filter((c) => c.time !== null && c.open !== null && c.high !== null && c.low !== null && c.close !== null);
// stats rows: numeric fields only, so no string from upstream can pass through
const numRow = (r) => Object.fromEntries(Object.entries(r && typeof r === 'object' ? r : {}).filter(([k, v]) => KEY_RE.test(k) && num(v) !== null));

// ---- perp blocks ----
async function perpBlocks(symbol, deps, now, iv) {
    const m = {};
    const missing = [];
    const [ov, st, lm, lh, c1h, c1d, civ] = await Promise.allSettled([
        futuresRest.overview(), futuresRest.stats(symbol, '1h'), futuresRest.liqmap(symbol), futuresRest.liqheat(symbol, '24h'),
        futuresRest.klines(symbol, '1h', 48), futuresRest.klines(symbol, '1d', 30),
        iv ? futuresRest.klines(symbol, iv, 48) : null, // the chart's own interval, when it is not 1h/1d
    ]);
    const val = (r) => (r.status === 'fulfilled' ? r.value : null);
    const h1 = candleRows(val(c1h));
    const d1 = candleRows(val(c1d));

    try { // live mark: only while fresh (<=10s), else the overview mark carries the price
        const k = futuresService.getMark(symbol);
        if (k && num(k.markPrice) > 0 && now - k.ts <= 10e3) m.live = { source: 'binance-ws', markPrice: num(k.markPrice), fundingRate: num(k.fundingRate), ts: num(k.ts) };
        else missing.push('live mark');
    } catch (e) { missing.push('live mark'); }

    const row = arr(val(ov)).find((r) => r && r.symbol === symbol);
    if (row) {
        m.overview = { source: tagOf(val(ov), 'binance-futures'), lastPrice: num(row.lastPrice), changePct24h: num(row.priceChangePercent), high: num(row.high), low: num(row.low), quoteVolume: num(row.quoteVolume), markPrice: num(row.markPrice), fundingRate: num(row.fundingRate), fundingIntervalHours: num(row.fundingIntervalHours), openInterestUsd: num(row.openInterestUsd) };
    } else missing.push('overview (24h change, funding, open interest)');

    if (h1.length || d1.length) m.trend = { source: tagOf(val(c1h), 'binance-futures'), ...trendOf(h1, d1) };
    if (h1.length) m.candles1h = { source: tagOf(val(c1h), 'binance-futures'), rows: h1.slice(-48) };
    else missing.push('1h candles');
    if (!d1.length) missing.push('daily candles');
    if (iv) {
        const rows = candleRows(val(civ));
        if (rows.length) m.candlesIv = { source: tagOf(val(civ), 'binance-futures'), interval: iv, rows: rows.slice(-48) };
        else missing.push(`${iv} candles`);
    }

    const s = val(st);
    if (s && !s.degraded) {
        const series = {};
        for (const k of ['openInterest', 'longShort', 'topLongShort', 'takerBuySell', 'funding']) series[k] = arr(s[k]).slice(-24).map(numRow);
        const sources = {};
        for (const k of Object.keys(series)) if (series[k].length) sources[k] = tagOf({ source: s.sources && s.sources[k] }, tagOf(s, 'binance-futures'));
        m.stats1h = { source: tagOf(s, 'binance-futures'), sources, series };
    } else missing.push('open interest / long-short stats');

    const l = val(lm);
    const ref = l && num(l.price) > 0 ? num(l.price) : null;
    if (ref) {
        const lv = arr(l.levels).map((x) => ({ price: num(x && x.price), longUsd: num(x && x.longUsd), shortUsd: num(x && x.shortUsd) })).filter((x) => x.price !== null);
        m.liqMapEstimate = { source: tagOf(l, 'binance-futures'), estimate: true, price: ref, longLiqNearest: nearestSide(lv, ref, 'longUsd'), shortLiqNearest: nearestSide(lv, ref, 'shortUsd') };
    } else missing.push('liquidation map estimate');

    const h = val(lh);
    if (h && h.keyLevels) {
        const band = (a) => arr(a).slice(0, 5).map((b) => ({ price: num(b && b.price), usd: num(b && b.usd), pctFromPrice: num(b && b.pct) })).filter((b) => b.price !== null);
        m.liqHeatEstimate = { source: tagOf(h, 'binance-futures'), estimate: true, range: '24h', above: band(h.keyLevels.above), below: band(h.keyLevels.below), totals: { longUsd: num(h.totals && h.totals.longUsd), shortUsd: num(h.totals && h.totals.shortUsd) } };
    } else missing.push('liquidation heatmap estimate');

    try {
        const liq = futuresService.getLiquidations(symbol);
        const w = {};
        for (const [name, ms] of Object.entries(WINDOWS)) {
            const o = { longUsd: 0, shortUsd: 0, count: 0 };
            for (const e of arr(liq && liq.events)) {
                if (!(num(e && e.ts) !== null && now - e.ts <= ms) || num(e.usd) === null) continue;
                o[e.side === 'long' ? 'longUsd' : 'shortUsd'] += e.usd;
                o.count++;
            }
            w[name] = o;
        }
        m.liquidationsSampled = { source: 'binance-ws', sampled: true, bufferSince: num(liq && liq.since), windows: w, note: 'sampled <=1 event/sec per symbol; only since bufferSince' };
    } catch (e) { missing.push('sampled liquidations'); }
    return { m, missing };
}

// ---- instrument + macro blocks (deps.instruments = { quotes(), klines(sym, iv, n) }, results as yahoo.quotes/klines) ----
const quoteRow = (r, st) => ({ source: 'yahoo', delayed: true, asOf: num(r.asOf), stale: !!(st || r.stale), symbol: r.symbol, name: (instruments.find(r.symbol) || {}).name || null, currency: (instruments.find(r.symbol) || {}).currency || null, price: num(r.price), changePct: num(r.changePct), high: num(r.high), low: num(r.low), volume: num(r.volume), marketOpen: typeof r.marketOpen === 'boolean' ? r.marketOpen : null });

async function instrumentBlocks(kind, symbol, deps) {
    const m = {};
    const missing = [];
    const inst = deps && deps.instruments;
    if (!inst || typeof inst.quotes !== 'function') return { m, missing: ['curated markets'] };
    const meta = kind === 'instrument' ? instruments.find(symbol) : null;
    if (kind === 'instrument' && !meta) missing.push('instrument');
    const [q, k1d, k1h] = await Promise.allSettled([
        inst.quotes(),
        kind === 'instrument' && meta ? inst.klines(meta.symbol, '1d', 30) : null,
        kind === 'instrument' && meta ? inst.klines(meta.symbol, '1h', 48) : null,
    ]);
    if (q.status === 'fulfilled' && q.value) {
        const rows = Array.isArray(q.value) ? q.value : arr(q.value.rows);
        const st = !Array.isArray(q.value) && q.value.stale;
        const pick = (s) => rows.find((r) => r && r.symbol === s);
        const macro = MACRO.map(pick).filter(Boolean).map((r) => quoteRow(r, st));
        if (macro.length) m.macro = { source: 'yahoo', delayed: true, asOf: Math.max(...macro.map((r) => r.asOf || 0)) || null, stale: macro.some((r) => r.stale), rows: macro };
        else missing.push('macro');
        if (meta) {
            const r = pick(meta.symbol);
            if (r) m.quote = quoteRow(r, st);
            else missing.push('quote');
        }
    } else { missing.push('macro'); if (meta) missing.push('quote'); }
    if (meta) {
        m.instrument = { source: 'static', symbol: meta.symbol, name: meta.name, category: meta.category, exchange: meta.exchange, currency: meta.currency };
        for (const [key, r] of [['candles1d', k1d], ['candles1h', k1h]]) {
            const v = r.status === 'fulfilled' && r.value;
            const rows = candleRows(Array.isArray(v) ? v : v && v.candles).slice(key === 'candles1d' ? -30 : -48);
            if (rows.length) m[key] = { source: 'yahoo', delayed: true, stale: !!(v && v.stale), rows };
            else missing.push(key);
        }
    }
    return { m, missing };
}

// ---- cache: market part only (shared, no user data) ----
const cache = new Map();
function market(kind, symbol, deps, now, iv) {
    const key = `${kind}|${symbol}|${iv || ''}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.p;
    const p = (async () => {
        const out = { m: {}, missing: [], at: now };
        const parts = [];
        if (kind === 'perp') parts.push(PERP_RE.test(symbol) ? perpBlocks(symbol, deps, now, iv) : { m: {}, missing: ['symbol'] });
        parts.push(instrumentBlocks(kind, symbol, deps));
        for (const r of await Promise.allSettled(parts)) {
            if (r.status === 'fulfilled') { Object.assign(out.m, r.value.m); out.missing.push(...r.value.missing); } else out.missing.push('block failed');
        }
        return out;
    })();
    cache.set(key, { at: now, p });
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return p;
}

// ---- portfolio (consent-gated, userId-filtered inside loadPortfolio) ----
async function portfolioBlock(userId) {
    const p = await loadPortfolio(userId);
    const held = Object.entries((p && p.spotHoldings) || {}).filter(([k, v]) => KEY_RE.test(k) && num(v) !== null && v > 0);
    return {
        source: 'paper-account',
        cashUsd: num(p && p.cashUsd),
        spotHoldings: Object.fromEntries(held),
        openFuturesPositions: arr(p && p.openFuturesPositions).filter((x) => x && KEY_RE.test(String(x.symbol))).map((x) => ({ symbol: x.symbol, side: x.side === 'short' ? 'short' : 'long', size: num(x.size), entryPrice: num(x.entryPrice), leverage: num(x.leverage), liqPrice: num(x.liqPrice), margin: num(x.margin) })),
    };
}

// A consenting user with hundreds of positions/holdings must not eat the whole prompt budget (nor push everything else out).
const PORTFOLIO_CAP = 20;

// ---- size bound ----
const rowsOf = (ctx, fn) => ['candles1h', 'candles1d', 'candlesIv'].reduce((ch, k) => (ctx[k] && ctx[k].rows.length > fn ? (ctx[k].rows = ctx[k].rows.slice(-fn), true) : ch), false);
const statsTo = (ctx, n) => { let ch = false; for (const k of Object.keys((ctx.stats1h && ctx.stats1h.series) || {})) if (ctx.stats1h.series[k].length > n) { ctx.stats1h.series[k] = ctx.stats1h.series[k].slice(-n); ch = true; } return ch; };
const TRIM = [
    ['candles:24', (c) => rowsOf(c, 24)], ['candles:12', (c) => rowsOf(c, 12)], ['stats:12', (c) => statsTo(c, 12)],
    ['liqLevels:5', (c) => { const l = c.liqMapEstimate; if (!l || l.longLiqNearest.length <= 5 && l.shortLiqNearest.length <= 5) return false; l.longLiqNearest = l.longLiqNearest.slice(0, 5); l.shortLiqNearest = l.shortLiqNearest.slice(0, 5); return true; }],
    ['macro', (c) => { const had = !!c.macro; delete c.macro; return had; }],
    ['liqHeat', (c) => { const had = !!c.liqHeatEstimate; delete c.liqHeatEstimate; return had; }],
];
const SECTION_KEYS = ['live', 'overview', 'trend', 'candles1h', 'candles1d', 'candlesIv', 'stats1h', 'liqMapEstimate', 'liqHeatEstimate', 'liquidationsSampled', 'instrument', 'quote', 'macro', 'portfolio'];

/**
 * @returns {{ctx: object, sources: Array<{section, source, asOf?, estimate?, sampled?, delayed?, stale?}>, chars: number, trimmed: string[]}}
 * Throws only for an unknown kind (the route validates it); upstream failures land in ctx.missing.
 */
async function buildAgentContext({ userId, kind, symbol, page, interval, includePortfolio, provider, deps = {} } = {}) {
    if (kind !== 'perp' && kind !== 'instrument') throw new Error('bad_kind');
    const now = typeof deps.now === 'function' ? deps.now() : Date.now();
    const sym = String(symbol || '').toUpperCase();
    const ivOk = kind === 'perp' && INTERVALS.includes(interval) && interval !== '1h' && interval !== '1d' ? interval : null;
    const { m, missing, at } = await market(kind, sym, deps, now, ivOk);
    const ctx = JSON.parse(JSON.stringify({ kind, symbol: PERP_RE.test(sym) || instruments.find(sym) ? sym : null, page: PAGES.includes(page) ? page : null, interval: /^\d{1,2}[mhdw]$/.test(String(interval)) ? interval : null, generatedAt: new Date(at).toISOString(), ...m, caps: kind === 'perp' ? CAPS_BLOCK : undefined, missing: [...missing] })); // copy: the cached part is shared
    if (includePortfolio === true && userId) {
        try { ctx.portfolio = await portfolioBlock(userId); } catch (e) { ctx.missing.push('portfolio'); }
    }
    const limit = provider === 'lmstudio' ? MAX_CHARS_LOCAL : MAX_CHARS;
    const trimmed = [];
    const pf = ctx.portfolio;
    if (pf) {
        if (pf.openFuturesPositions.length > PORTFOLIO_CAP) { pf.openFuturesPositions = pf.openFuturesPositions.slice(0, PORTFOLIO_CAP); trimmed.push(`positions:${PORTFOLIO_CAP}`); }
        const held = Object.entries(pf.spotHoldings);
        if (held.length > PORTFOLIO_CAP) { pf.spotHoldings = Object.fromEntries(held.slice(0, PORTFOLIO_CAP)); trimmed.push(`holdings:${PORTFOLIO_CAP}`); }
    }
    for (const [name, fn] of TRIM) {
        if (JSON.stringify(ctx).length <= limit) break;
        if (fn(ctx)) trimmed.push(name);
    }
    // hard stop: the steps above can run out of things to cut (big portfolio, tiny local limit)
    for (const [k, name] of [['portfolio', 'portfolio'], ['liqHeatEstimate', 'liqHeat']]) {
        if (ctx[k] && JSON.stringify(ctx).length > limit) { delete ctx[k]; trimmed.push(name); }
    }
    if (trimmed.length) ctx.trimmed = trimmed;
    const sources = SECTION_KEYS.filter((k) => ctx[k] && ctx[k].source).map((k) => {
        const b = ctx[k];
        return { section: k, source: b.source, ...(num(b.asOf) !== null && { asOf: b.asOf }), ...(b.estimate && { estimate: true }), ...(b.sampled && { sampled: true }), ...(b.delayed && { delayed: true }), ...(b.stale && { stale: true }) };
    });
    return { ctx, sources, chars: JSON.stringify(ctx).length, trimmed };
}

module.exports = { buildAgentContext, MAX_CHARS, MAX_CHARS_LOCAL, _test: { reset: () => cache.clear() } };
