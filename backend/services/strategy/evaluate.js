const { parseSpec, STRATEGY_LIMITS, EVAL_SECONDS, MULTI } = require('./schema');
const ind = require('./indicators');
const { simulate, stats, CAVEATS, SMALL_SAMPLE, OPEN_TRADE } = require('./backtest');

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x, lo, hi, d) => (finite(x) ? Math.min(hi, Math.max(lo, x)) : d);

function computeSeries(spec, candles) {
    const m = new Map();
    for (const k of ['open', 'high', 'low', 'close', 'volume']) m.set(k, candles.map((c) => c[k]));
    for (const d of spec.indicators) {
        const src = m.get(d.source || 'close');
        if (d.type === 'sma') m.set(d.id, ind.sma(src, d.period));
        else if (d.type === 'ema') m.set(d.id, ind.ema(src, d.period));
        else if (d.type === 'rsi') m.set(d.id, ind.rsi(src, d.period));
        else if (d.type === 'atr') m.set(d.id, ind.atr(candles, d.period));
        else if (d.type === 'volume_sma') m.set(d.id, ind.sma(m.get('volume'), d.period));
        else if (d.type === 'bollinger') {
            const r = ind.bollinger(src, d.period, d.stdDev);
            MULTI.bollinger.forEach((f) => m.set(`${d.id}.${f}`, r[f]));
        } else if (d.type === 'macd') {
            const r = ind.macd(src, d.fast, d.slow, d.signal);
            MULTI.macd.forEach((f) => m.set(`${d.id}.${f}`, r[f]));
        }
    }
    return m;
}

// Operand at bar i (null if unavailable). Only reads index <= i.
function operandAt(m, o, i) {
    if (typeof o === 'number') return o;
    if (typeof o === 'string') return m.get(o)[i];
    const v = m.get(o.ref)[i];
    return v === null ? null : v * o.mul;
}

function condAt(m, c, i) {
    const l = m.get(c.left)[i], r = operandAt(m, c.right, i);
    if (l === null || r === null) return false;
    if (c.op === 'gt') return l > r;
    if (c.op === 'gte') return l >= r;
    if (c.op === 'lt') return l < r;
    if (c.op === 'lte') return l <= r;
    if (i === 0) return false;
    const pl = m.get(c.left)[i - 1], pr = operandAt(m, c.right, i - 1);
    if (pl === null || pr === null) return false;
    return c.op === 'crosses_above' ? pl <= pr && l > r : pl >= pr && l < r;
}

function groupSignals(m, g, n) {
    const out = new Array(n).fill(false);
    if (!g) return out;
    const list = g.all || g.any;
    for (let i = 0; i < n; i++) out[i] = g.all ? list.every((c) => condAt(m, c, i)) : list.some((c) => condAt(m, c, i));
    return out;
}

// Shared by evaluate and signalAt so both see the same validated spec and the same closed candles.
// spec is re-validated here so a caller can never feed an unchecked object to the interpreter.
// opts.interval = candle interval the rows are on (default spec.timeframe); opts.now in ms; the last candle is dropped while still forming (time + interval > now).
function prepare(rawSpec, rawCandles, opts) {
    const p = parseSpec(rawSpec);
    if (!p.ok) { const e = new Error('invalid_spec'); e.issues = p.issues; throw e; }
    const spec = p.spec;
    const now = finite(opts.now) ? opts.now : Date.now();
    let candles = (Array.isArray(rawCandles) ? rawCandles : [])
        .filter((c) => c && [c.time, c.open, c.high, c.low, c.close, c.volume].every(finite))
        .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }))
        .sort((a, b) => a.time - b.time)
        .slice(-STRATEGY_LIMITS.maxCandles);
    // the forming-candle cut uses the interval actually evaluated (opts.interval), not the spec's designed-on timeframe
    const iv = EVAL_SECONDS[opts.interval] || EVAL_SECONDS[spec.timeframe];
    if (candles.length && (candles[candles.length - 1].time + iv) * 1000 > now) candles = candles.slice(0, -1);
    return { spec, candles };
}

function evaluate(rawSpec, rawCandles, opts = {}) {
    const { spec, candles } = prepare(rawSpec, rawCandles, opts);
    const costs = { slippagePct: clamp(opts.slippagePct, 0, 1, 0.02), feePct: clamp(opts.feePct, 0, 1, 0.05) };
    const n = candles.length;
    const m = computeSeries(spec, candles);
    const g = (w, s) => groupSignals(m, spec[w] && spec[w][s], n);
    const entryLong = g('entry', 'long'), entryShort = g('entry', 'short');
    const sig = { entryLong, exitLong: g('exit', 'long'), exitShort: g('exit', 'short'), entrySide: (i) => (entryShort[i] ? 'short' : null) };
    const risk = spec.risk || {};
    const sim = n ? simulate(candles, sig, risk, costs) : { trades: [], openTrade: null, markers: [], barsIn: 0 };
    const st = stats(candles, sim.trades, sim.barsIn, sim.openTrade);
    const series = {};
    for (const name of spec.plot || []) {
        const keys = m.has(name) ? [name] : MULTI[spec.indicators.find((d) => d.id === name).type].map((f) => `${name}.${f}`);
        for (const k of keys) series[k] = m.get(k).map((v, i) => (v === null ? null : { time: candles[i].time, value: v })).filter(Boolean);
    }
    return {
        series,
        markers: sim.markers.slice(-STRATEGY_LIMITS.maxMarkers),
        trades: sim.trades.slice(-STRATEGY_LIMITS.maxTrades),
        stats: st,
        caveats: [...CAVEATS, ...(sim.trades.length < 30 ? [SMALL_SAMPLE] : []), ...(sim.openTrade ? [OPEN_TRADE] : [])],
        evaluatedThrough: n ? candles[n - 1].time : null,
        costs,
    };
}

// EMA/RSI/MACD/ATR are recursive and seeded at the first candle of the window, so their values depend on where the window
// starts: a live signal on a 500-candle window can differ from the backtest on a longer one. The seed's influence decays
// geometrically, so live signals are refused until the window holds WARMUP_MULT x the longest period (and at least WARMUP_MIN).
// Backtests (evaluate) are unchanged. Caveat that remains: even warmed up, values differ slightly from a longer window.
const WARMUP_MULT = 3, WARMUP_MIN = 30;
const longest = (spec) => Math.max(1, ...spec.indicators.map((d) => d.period || (d.slow + d.signal)));

// Live signal: the decision the backtest uses at the last CLOSED bar, from the same interpreter (groupSignals).
// Reads only candles up to that bar, so later candles cannot change it. conds = per-condition values for the audit reason.
// Too few candles -> { warmingUp: true, need, have, all signals false } so a caller never trades on seed-dominated values.
function signalAt(rawSpec, rawCandles, opts = {}) {
    const { spec, candles } = prepare(rawSpec, rawCandles, opts);
    const n = candles.length;
    if (!n) return null;
    const need = Math.max(WARMUP_MIN, WARMUP_MULT * longest(spec));
    if (n < need) return { barTime: candles[n - 1].time, warmingUp: true, need, have: n, entryLong: false, entryShort: false, exitLong: false, exitShort: false, conds: {} };
    const m = computeSeries(spec, candles), i = n - 1;
    const sig = (w, s) => groupSignals(m, spec[w] && spec[w][s], n)[i];
    const conds = {};
    for (const w of ['entry', 'exit']) for (const s of ['long', 'short']) {
        const g = spec[w] && spec[w][s];
        if (g) conds[`${w}${s[0].toUpperCase()}${s.slice(1)}`] = (g.all || g.any).map((c) => {
            const r = operandAt(m, c.right, i);
            return { left: c.left, op: c.op, right: c.right, leftValue: m.get(c.left)[i], rightValue: r, met: condAt(m, c, i) };
        });
    }
    return { barTime: candles[i].time, entryLong: sig('entry', 'long'), entryShort: sig('entry', 'short'), exitLong: sig('exit', 'long'), exitShort: sig('exit', 'short'), conds };
}

module.exports = { evaluate, signalAt, WARMUP_MIN, WARMUP_MULT };
