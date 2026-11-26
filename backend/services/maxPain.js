// Multi-coin "max pain" board: for the top perps by volume, the strongest estimated long-liquidation level below the price and
// short-liquidation level above it, taken from the cached liqheat estimate (same inferred positions as the heatmap, not exchange data).
// Per-symbol liqheat is shared with GET /liqheat via futuresRest's own 60 s cache; this module only adds the aggregate cache.
const logger = require('../config/logger');
const futuresRest = require('./futuresRest');

const MAX_TOP = 30; // hard cap: each symbol costs 2 Binance calls on a cold cache
const DEFAULT_TOP = 20;
const CONCURRENCY = 4;
const FRESH_MS = 60e3;
const STALE_MAX_MS = 10 * 60e3; // older than this is not served at all
const MAX_KEYS = 16;

// Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf), max abs error ~1.5e-7.
function normCdf(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// Stdev of one-candle log returns scaled to the whole window (sqrt-time). null with too little history.
function windowSigma(candles, colMs, horizonMs) {
    if (!Array.isArray(candles) || candles.length < 11 || !(colMs > 0)) return null;
    const r = [];
    for (let i = 1; i < candles.length; i++) {
        const a = candles[i - 1].close;
        const b = candles[i].close;
        if (a > 0 && b > 0) r.push(Math.log(b / a));
    }
    if (r.length < 10) return null;
    const mean = r.reduce((s, x) => s + x, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1));
    return sd > 0 ? sd * Math.sqrt(horizonMs / colMs) : null;
}

// Distance in sigmas and the driftless-Brownian touch probability 2(1 - Phi(d)). A volatility-based estimate, not a forecast.
function touchStats(price, level, sigma) {
    if (!(sigma > 0) || !(price > 0) || !(level > 0)) return { sigma: null, touchPct: null };
    const d = Math.abs(Math.log(level / price)) / sigma;
    return { sigma: +d.toFixed(2), touchPct: +Math.min(100, 2 * (1 - normCdf(d)) * 100).toFixed(1) };
}

const pick = (list) => (list || []).reduce((best, l) => (!best || l.usd > best.usd ? l : best), null);

// One symbol's row from a liqheat payload; null when it has no level on either side.
function rowOf(h, win, quoteVolume) {
    const { ms, w } = futuresRest.HEAT_RANGES[win];
    const sig = windowSigma(h.candles, h.colMs || ms, w * ms);
    const mk = (l) => l && { price: l.price, pct: +(((l.price - h.price) / h.price) * 100).toFixed(2), usd: l.usd, ...touchStats(h.price, l.price, sig) };
    const below = mk(pick(h.keyLevels && h.keyLevels.below));
    const above = mk(pick(h.keyLevels && h.keyLevels.above));
    if (!below && !above) return null;
    return {
        symbol: h.symbol, price: h.price, quoteVolume, below, above,
        longUsd: (h.totals && h.totals.longUsd) || 0, shortUsd: (h.totals && h.totals.shortUsd) || 0,
        ...(h.partial && { partial: true }),
    };
}

async function build(win, top) {
    const ov = await futuresRest.overview();
    const syms = [...ov].sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0)).slice(0, top);
    const rows = [];
    let skipped = 0;
    const queue = [...syms];
    const worker = async () => {
        for (let s = queue.shift(); s; s = queue.shift()) {
            try {
                const h = await futuresRest.liqheat(s.symbol, win);
                const row = rowOf(h, win, s.quoteVolume);
                if (row) rows.push(row); else skipped++;
            } catch (e) { skipped++; }
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!rows.length && syms.length) throw new Error('no max-pain rows');
    rows.sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
    return {
        window: win, top, generatedAt: Date.now(), method: 'oi-delta-leverage-tiers', count: rows.length, skipped, rows,
        // ponytail: confluence across windows is not computed here (4x the upstream calls); the UI derives it for the selected coin from /liqheat.
        confluence: 'omitted',
        touchNote: 'Volatility-based estimate, not a forecast',
    };
}

const store = new Map(); // `${win}:${top}` -> { body, at, p }

// Fresh (< 60 s) answers come from memory; a stale one (< 10 min) is returned at once with stale:true while one refresh runs.
async function maxPain(win, top) {
    if (!Object.prototype.hasOwnProperty.call(futuresRest.HEAT_RANGES, win)) throw Object.assign(new Error('invalid window'), { status: 400 });
    const n = Math.min(MAX_TOP, Math.max(1, Math.floor(top) || DEFAULT_TOP));
    const key = `${win}:${n}`;
    let e = store.get(key);
    const age = e && e.body ? Date.now() - e.at : Infinity;
    if (age < FRESH_MS) return e.body;
    if (!e || !e.p) {
        if (!e) {
            if (store.size >= MAX_KEYS) store.delete(store.keys().next().value);
            e = { body: null, at: 0, p: null };
            store.set(key, e);
        }
        e.p = build(win, n).then((b) => { e.body = b; e.at = Date.now(); }, (err) => {
            if (e.body) logger.warn(`maxPain: refresh failed (${err.message}); serving stale`);
            else store.delete(key);
            e.err = err;
        }).finally(() => { e.p = null; });
    }
    if (age < STALE_MAX_MS) return { ...e.body, stale: true };
    await e.p;
    if (!e.body) throw e.err || new Error('max pain unavailable');
    return e.body;
}

module.exports = { maxPain, normCdf, windowSigma, touchStats, rowOf, MAX_TOP, DEFAULT_TOP, _test: { reset: () => store.clear() } };
