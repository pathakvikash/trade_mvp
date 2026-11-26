// Bot capability study (walk-forward, out-of-sample only). Usage: node study.js <klinesDir> <out.json>
// Uses the app's own parseSpec, indicators and backtest.simulate/stats with the app defaults (fee 0.05%/side of notional,
// slippage 0.02% per fill). evaluate() caps at 1000 candles, so the signal code below is a verbatim copy of evaluate.js
// computeSeries/condAt/groupSignals over the full series; a parity assert vs evaluate() on a 1000-candle window runs first.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { parseSpec } = require('../../services/strategy/schema');
const ind = require('../../services/strategy/indicators');
const { simulate, stats } = require('../../services/strategy/backtest');
const { evaluate } = require('../../services/strategy/evaluate');
const { MULTI } = require('../../services/strategy/schema');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT', 'MANTRAUSDT'];
const TFS = ['15m', '1h', '4h'];
const FEE = 0.05, SLIP = 0.02;
const STOPS = [0.5, 1, 2], TARGETS = [1, 2, 4, null];
const RANDOM_RUNS = 200;

// ---- verbatim from services/strategy/evaluate.js ----
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
        else if (d.type === 'bollinger') { const r = ind.bollinger(src, d.period, d.stdDev); MULTI.bollinger.forEach((f) => m.set(`${d.id}.${f}`, r[f])); }
        else if (d.type === 'macd') { const r = ind.macd(src, d.fast, d.slow, d.signal); MULTI.macd.forEach((f) => m.set(`${d.id}.${f}`, r[f])); }
    }
    return m;
}
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
// ---- end copy ----

// Families: build(params) -> { indicators, long: {entry, exit}, short: {entry, exit} }. All expressible in DSL v1.
const C = (left, op, right) => ({ left, op, right });
const FAMILIES = {
    ema_cross: { grid: [[9, 21], [20, 50], [50, 200]], build: ([f, s]) => ({ indicators: [{ id: 'f', type: 'ema', period: f }, { id: 's', type: 'ema', period: s }], long: [{ all: [C('f', 'crosses_above', 's')] }, { any: [C('f', 'crosses_below', 's')] }], short: [{ all: [C('f', 'crosses_below', 's')] }, { any: [C('f', 'crosses_above', 's')] }] }) },
    sma_cross: { grid: [[10, 30], [20, 50], [50, 200]], build: ([f, s]) => ({ indicators: [{ id: 'f', type: 'sma', period: f }, { id: 's', type: 'sma', period: s }], long: [{ all: [C('f', 'crosses_above', 's')] }, { any: [C('f', 'crosses_below', 's')] }], short: [{ all: [C('f', 'crosses_below', 's')] }, { any: [C('f', 'crosses_above', 's')] }] }) },
    macd_cross: { grid: [[12, 26, 9], [8, 21, 5]], build: ([f, s, g]) => ({ indicators: [{ id: 'm', type: 'macd', fast: f, slow: s, signal: g }], long: [{ all: [C('m.macd', 'crosses_above', 'm.signal')] }, { any: [C('m.macd', 'crosses_below', 'm.signal')] }], short: [{ all: [C('m.macd', 'crosses_below', 'm.signal')] }, { any: [C('m.macd', 'crosses_above', 'm.signal')] }] }) },
    rsi_revert: { grid: [[14, 30], [14, 25], [7, 20]], build: ([p, lo]) => ({ indicators: [{ id: 'r', type: 'rsi', period: p }], long: [{ all: [C('r', 'lt', lo)] }, { any: [C('r', 'gt', 50)] }], short: [{ all: [C('r', 'gt', 100 - lo)] }, { any: [C('r', 'lt', 50)] }] }) },
    rsi_momo: { grid: [[14, 55], [14, 60]], build: ([p, hi]) => ({ indicators: [{ id: 'r', type: 'rsi', period: p }], long: [{ all: [C('r', 'crosses_above', hi)] }, { any: [C('r', 'lt', 50)] }], short: [{ all: [C('r', 'crosses_below', 100 - hi)] }, { any: [C('r', 'gt', 50)] }] }) },
    bb_revert: { grid: [[20, 2], [20, 2.5]], build: ([p, k]) => ({ indicators: [{ id: 'b', type: 'bollinger', period: p, stdDev: k }], long: [{ all: [C('close', 'lt', 'b.lower')] }, { any: [C('close', 'crosses_above', 'b.middle')] }], short: [{ all: [C('close', 'gt', 'b.upper')] }, { any: [C('close', 'crosses_below', 'b.middle')] }] }) },
    bb_breakout: { grid: [[20, 2], [20, 2.5]], build: ([p, k]) => ({ indicators: [{ id: 'b', type: 'bollinger', period: p, stdDev: k }], long: [{ all: [C('close', 'crosses_above', 'b.upper')] }, { any: [C('close', 'crosses_below', 'b.middle')] }], short: [{ all: [C('close', 'crosses_below', 'b.lower')] }, { any: [C('close', 'crosses_above', 'b.middle')] }] }) },
    trend_pullback: { grid: [[200, 35], [200, 40], [100, 40]], build: ([t, x]) => ({ indicators: [{ id: 't', type: 'ema', period: t }, { id: 'r', type: 'rsi', period: 14 }], long: [{ all: [C('close', 'gt', 't'), C('r', 'lt', x)] }, { any: [C('r', 'gt', 55)] }], short: [{ all: [C('close', 'lt', 't'), C('r', 'gt', 100 - x)] }, { any: [C('r', 'lt', 45)] }] }) },
    vol_breakout: { grid: [[20, 1.5], [20, 2]], build: ([p, k]) => ({ indicators: [{ id: 'e', type: 'ema', period: p }, { id: 'v', type: 'volume_sma', period: p }], long: [{ all: [C('close', 'crosses_above', 'e'), C('volume', 'gt', { ref: 'v', mul: k })] }, { any: [C('close', 'crosses_below', 'e')] }], short: [{ all: [C('close', 'crosses_below', 'e'), C('volume', 'gt', { ref: 'v', mul: k })] }, { any: [C('close', 'crosses_above', 'e')] }] }) },
};
const DIRS = ['long', 'short', 'both'];

function specOf(fam, params, dir, tf, stop, target) {
    const b = FAMILIES[fam].build(params);
    const entry = {}, exit = {};
    for (const s of ['long', 'short']) if (dir === s || dir === 'both') { entry[s] = b[s][0]; exit[s] = b[s][1]; }
    const risk = { stopPct: stop };
    if (target) risk.targetPct = target;
    const p = parseSpec({ version: 1, name: `${fam} ${params.join('/')}`, timeframe: tf, direction: dir, indicators: b.indicators, entry, exit, risk });
    if (!p.ok) throw new Error(`${fam} invalid: ${JSON.stringify(p.issues)}`);
    return p.spec;
}

const sl = (a, lo, hi) => a.slice(lo, hi);
function runSlice(candles, sigs, lo, hi, risk, fee = FEE) {
    const c = candles.slice(lo, hi);
    const es = sl(sigs.entryShort, lo, hi);
    const sig = { entryLong: sl(sigs.entryLong, lo, hi), exitLong: sl(sigs.exitLong, lo, hi), exitShort: sl(sigs.exitShort, lo, hi), entrySide: (i) => (es[i] ? 'short' : null) };
    const sim = simulate(c, sig, risk, { slippagePct: SLIP, feePct: fee });
    return { trades: sim.trades, st: stats(c, sim.trades, sim.barsIn, sim.openTrade) };
}

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Random entries at the strategy's entry rate when flat, random exits at 1/avg-hold, same stop/target/direction/costs.
function randomBaseline(candles, lo, hi, dir, risk, trades, barsIn, seed) {
    const n = hi - lo, flat = Math.max(1, n - barsIn);
    const pe = Math.min(1, trades.length / flat);
    const avgBars = trades.length ? trades.reduce((s, t) => s + t.bars, 0) / trades.length : 10;
    const px = 1 / Math.max(1, avgBars);
    const rnd = mulberry(seed);
    const out = [];
    for (let r = 0; r < RANDOM_RUNS; r++) {
        const eL = new Array(n), eS = new Array(n), x = new Array(n);
        for (let i = 0; i < n; i++) {
            const e = rnd() < pe, side = dir === 'both' ? (rnd() < 0.5 ? 'long' : 'short') : dir;
            eL[i] = e && side === 'long'; eS[i] = e && side === 'short'; x[i] = rnd() < px;
        }
        const sim = simulate(candles.slice(lo, hi), { entryLong: eL, exitLong: x, exitShort: x, entrySide: (i) => (eS[i] ? 'short' : null) }, risk, { slippagePct: SLIP, feePct: FEE });
        out.push(sim.trades.reduce((s, t) => s + t.returnPct, 0));
    }
    return out;
}

// Regime per bar from the PAST 100 bars only: high-vol (top tercile of rolling return stdev), else trend (efficiency
// ratio >= series median), else range. Thresholds use whole-series quantiles: descriptive labelling, not a trading input.
function regimes(candles) {
    const L = 100, n = candles.length, vol = new Array(n).fill(null), er = new Array(n).fill(null);
    for (let i = L; i < n; i++) {
        let s = 0, s2 = 0, path = 0;
        for (let j = i - L + 1; j <= i; j++) { const r = Math.log(candles[j].close / candles[j - 1].close); s += r; s2 += r * r; path += Math.abs(candles[j].close - candles[j - 1].close); }
        vol[i] = Math.sqrt(s2 / L - (s / L) ** 2);
        er[i] = path ? Math.abs(candles[i].close - candles[i - L].close) / path : 0;
    }
    const q = (a, p) => { const b = a.filter((x) => x !== null).sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
    const v67 = q(vol, 2 / 3), erMed = q(er, 0.5);
    return vol.map((v, i) => (v === null ? 'warmup' : v >= v67 ? 'highvol' : er[i] >= erMed ? 'trend' : 'range'));
}

function maxDDPrice(candles, lo, hi) { let pk = 0, dd = 0; for (let i = lo; i < hi; i++) { pk = Math.max(pk, candles[i].close); dd = Math.max(dd, (1 - candles[i].low / pk) * 100); } return dd; }

function parity(candles) {
    const spec = specOf('ema_cross', [20, 50], 'both', '1h', 1, 2);
    const w = candles.slice(-1000);
    const ev = evaluate(spec, w, { interval: '1h', now: Date.now() + 864e5 * 365 });
    const m = computeSeries(spec, w), n = w.length;
    const sigs = { entryLong: groupSignals(m, spec.entry.long, n), entryShort: groupSignals(m, spec.entry.short, n), exitLong: groupSignals(m, spec.exit.long, n), exitShort: groupSignals(m, spec.exit.short, n) };
    const mine = runSlice(w, sigs, 0, n, spec.risk);
    assert.strictEqual(mine.st.trades, ev.stats.trades);
    assert.strictEqual(mine.st.totalReturnPct, ev.stats.totalReturnPct);
    return { trades: ev.stats.trades, totalReturnPct: ev.stats.totalReturnPct };
}

function main() {
    const [dir, outFile] = process.argv.slice(2);
    const load = (s, tf) => JSON.parse(fs.readFileSync(path.join(dir, `${s}_${tf}.json`), 'utf8'));
    const out = { costs: { feePctPerSide: FEE, slippagePctPerFill: SLIP }, parity: parity(load('BTCUSDT', '1h')), data: [], cells: [], allConfigs: { oos: 0, oosProfitable: 0, oosBeatBH: 0 }, rolling: { tests: 0, profitable: 0, rows: [] }, regimeTrades: {} };
    let seed = 1;
    for (const sym of SYMBOLS) for (const tf of TFS) {
        const candles = load(sym, tf), n = candles.length, cut = Math.floor(n * 0.6);
        const reg = regimes(candles);
        const bhOOS = (candles[n - 1].close / candles[cut].open - 1) * 100 - 2 * FEE;
        const ddBH = maxDDPrice(candles, cut, n);
        out.data.push({ sym, tf, n, from: new Date(candles[0].time * 1000).toISOString().slice(0, 10), to: new Date(candles[n - 1].time * 1000).toISOString().slice(0, 10), oosFrom: new Date(candles[cut].time * 1000).toISOString().slice(0, 10), bhOOS: +bhOOS.toFixed(2), ddBH: +ddBH.toFixed(2) });
        const folds = [0, 1, 2, 3, 4, 5].map((k) => Math.floor((n * k) / 5));
        for (const fam of Object.keys(FAMILIES)) {
            // signals once per param set (direction/risk only change which arrays the simulator reads)
            const sets = FAMILIES[fam].grid.map((params) => {
                const spec = specOf(fam, params, 'both', tf, 1, null);
                const m = computeSeries(spec, candles);
                return { params, sigs: { entryLong: groupSignals(m, spec.entry.long, n), entryShort: groupSignals(m, spec.entry.short, n), exitLong: groupSignals(m, spec.exit.long, n), exitShort: groupSignals(m, spec.exit.short, n) } };
            });
            const none = new Array(n).fill(false);
            const forDir = (s, d) => ({ entryLong: d === 'short' ? none : s.entryLong, entryShort: d === 'long' ? none : s.entryShort, exitLong: s.exitLong, exitShort: s.exitShort });
            for (const d of DIRS) {
                const configs = [];
                for (const s of sets) for (const stop of STOPS) for (const target of TARGETS) {
                    specOf(fam, s.params, d, tf, stop, target); // every config must be a valid DSL spec
                    configs.push({ params: s.params, sigs: forDir(s.sigs, d), risk: target ? { stopPct: stop, targetPct: target } : { stopPct: stop } });
                }
                // in-sample selection: best total net return with >= 10 IS trades (fallback: best overall)
                let best = null, bestScore = -Infinity;
                for (const c of configs) {
                    const is = runSlice(candles, c.sigs, 0, cut, c.risk);
                    const score = is.st.trades >= 10 ? is.st.totalReturnPct : is.st.totalReturnPct - 1e6;
                    if (score > bestScore) { bestScore = score; best = { ...c, is: is.st }; }
                    const o = runSlice(candles, c.sigs, cut, n, c.risk);
                    out.allConfigs.oos++;
                    if (o.st.totalReturnPct > 0) out.allConfigs.oosProfitable++;
                    if (o.st.totalReturnPct > bhOOS) out.allConfigs.oosBeatBH++;
                }
                // rolling: choose on fold k-1, test on fold k
                for (let k = 2; k <= 5; k++) {
                    let rb = null, rs = -Infinity;
                    for (const c of configs) { const r = runSlice(candles, c.sigs, folds[k - 2], folds[k - 1], c.risk).st; const sc = r.trades >= 5 ? r.totalReturnPct : r.totalReturnPct - 1e6; if (sc > rs) { rs = sc; rb = c; } }
                    const t = runSlice(candles, rb.sigs, folds[k - 1], folds[k], rb.risk).st;
                    const fbh = (candles[folds[k] - 1].close / candles[folds[k - 1]].open - 1) * 100 - 2 * FEE;
                    out.rolling.rows.push({ sym, tf, fam, dir: d, fold: k, ret: t.totalReturnPct, trades: t.trades, bh: +fbh.toFixed(2), from: new Date(candles[folds[k - 1]].time * 1000).toISOString().slice(0, 10) });
                    out.rolling.tests++;
                    if (t.totalReturnPct > 0) out.rolling.profitable++;
                }
                const oos = runSlice(candles, best.sigs, cut, n, best.risk);
                const fees = Object.fromEntries([0.5, 1, 2].map((x) => [`x${x}`, runSlice(candles, best.sigs, cut, n, best.risk, FEE * x).st.totalReturnPct]));
                const rnd = randomBaseline(candles, cut, n, d, best.risk, oos.trades, Math.round(oos.st.exposurePct / 100 * (n - cut)), seed++);
                const rMean = rnd.reduce((a, b) => a + b, 0) / rnd.length;
                let p = (1 + rnd.filter((x) => x >= oos.st.totalReturnPct).length) / (1 + rnd.length);
                let pHi = null;
                if (p < 0.05 && oos.st.trades >= 30) {
                    const big = []; for (let b = 0; b < 25; b++) big.push(...randomBaseline(candles, cut, n, d, best.risk, oos.trades, Math.round(oos.st.exposurePct / 100 * (n - cut)), 1e6 + seed * 100 + b));
                    pHi = (1 + big.filter((x) => x >= oos.st.totalReturnPct).length) / (1 + big.length);
                }
                // regime tags for OOS trades (entry bar regime)
                const idxOf = new Map(candles.map((c, i) => [c.time, i]));
                for (const t of oos.trades) {
                    const key = `${fam}|${reg[idxOf.get(t.entryTime)]}`;
                    const a = out.regimeTrades[key] || (out.regimeTrades[key] = { n: 0, sum: 0 });
                    a.n++; a.sum += t.returnPct;
                }
                // margin equity path at leverage L: L x cumulative notional return (fixed notional, no compounding)
                const path = []; let eq = 0; for (const t of oos.trades) { eq += t.returnPct; path.push(eq); }
                const minEq = path.length ? Math.min(0, ...path) : 0;
                const worstTrade = oos.trades.length ? Math.min(...oos.trades.map((t) => t.returnPct)) : 0;
                out.cells.push({
                    sym, tf, fam, dir: d, chosen: { params: best.params, ...best.risk }, isReturn: best.is.totalReturnPct, isTrades: best.is.trades,
                    oosTrades: oos.st.trades, oosReturn: oos.st.totalReturnPct, oosWin: oos.st.winRate, oosDD: oos.st.maxDrawdownPct, exposure: oos.st.exposurePct,
                    fees, bh: +bhOOS.toFixed(2), ddBH: +ddBH.toFixed(2), rndMean: +rMean.toFixed(2), p: +p.toFixed(4), pHi, minEqNotional: +minEq.toFixed(2), worstTrade: +worstTrade.toFixed(2),
                    avgTrade: oos.st.trades ? +(oos.st.totalReturnPct / oos.st.trades).toFixed(4) : null,
                });
            }
        }
        console.error('done', sym, tf);
    }
    fs.writeFileSync(outFile, JSON.stringify(out));
}
main();
