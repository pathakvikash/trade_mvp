const fs = require('fs');
const path = require('path');
// Reference vectors computed independently in Python (python3 3.x, plain float maths).
const REF = {"c": [44, 44.5, 43.8, 45.2, 46.1, 45.7, 47.0, 46.2, 45.1, 44.9, 46.5, 47.8], "h": [45, 45.5, 44.8, 46.2, 47.1, 46.7, 48.0, 47.2, 46.1, 45.9, 47.5, 48.8], "l": [42.5, 43.0, 42.3, 43.7, 44.6, 44.2, 45.5, 44.7, 43.6, 43.4, 45.0, 46.3], "v": [100, 120, 90, 150, 130, 110, 160, 140, 100, 95, 170, 180], "sma3": [null, null, 44.1, 44.5, 45.03333333333333, 45.666666666666664, 46.26666666666667, 46.300000000000004, 46.1, 45.4, 45.5, 46.4], "ema3": [null, null, 44.1, 44.650000000000006, 45.375, 45.5375, 46.26875, 46.234375, 45.6671875, 45.283593749999994, 45.891796875, 46.8458984375], "rsi5": [null, null, null, null, null, 71.7948717948718, 80.09049773755655, 65.3136531365314, 49.58851339520224, 47.01585456960236, 65.1144996447505, 74.09986191225528], "atr5": [null, null, null, null, null, 2.5, 2.5, 2.5, 2.5200000000000005, 2.5160000000000005, 2.532800000000001, 2.5262400000000005], "bm": [null, null, null, null, 44.72, 45.06, 45.56, 46.040000000000006, 46.02, 45.78, 45.94, 46.1], "bu": [null, null, null, null, 46.40475517509222, 46.71215011424508, 47.67886762210385, 47.23063008529098, 47.26835892274618, 47.30525407719501, 47.56283702200806, 48.1976176963403], "bl": [null, null, null, null, 43.03524482490778, 43.40784988575493, 43.44113237789615, 44.84936991470903, 44.771641077253825, 44.25474592280499, 44.317162977991934, 44.0023823036597], "macd": [null, null, null, null, null, 0.6541666666666686, 0.7806547619047564, 0.5428784013605394, 0.14468992954324023, -0.06104737175483166, 0.21705321660369492, 0.5639386815026342], "sig": [null, null, null, null, null, null, null, 0.6592332766439881, 0.4019616030936142, 0.17045711566939126, 0.1937551661365431, 0.3788469238195886], "hist": [null, null, null, null, null, null, null, -0.11635487528344868, -0.25727167355037395, -0.23150448742422292, 0.023298050467151832, 0.18509175768304553], "vsma": [null, null, 103.33333333333333, 120.0, 123.33333333333333, 130.0, 133.33333333333334, 136.66666666666666, 133.33333333333334, 111.66666666666667, 121.66666666666667, 148.33333333333334]};

const { parseSpec, STRATEGY_LIMITS } = require('../services/strategy/schema');
const ind = require('../services/strategy/indicators');
const { evaluate } = require('../services/strategy/evaluate');
const { describe: describeSpec } = require('../services/strategy/describe');

const FAR = 4e12; // "now" far in the future: every candle is closed
const H = 3600;
const base = () => ({
  version: 1, name: 'EMA cross', timeframe: '1h', direction: 'long',
  indicators: [
    { id: 'fast', type: 'ema', period: 20 }, { id: 'slow', type: 'ema', period: 50 },
    { id: 'rsi', type: 'rsi', period: 14 }, { id: 'bb', type: 'bollinger', period: 20, stdDev: 2 },
    { id: 'm', type: 'macd', fast: 12, slow: 26, signal: 9 },
  ],
  entry: { long: { all: [{ left: 'fast', op: 'crosses_above', right: 'slow' }, { left: 'rsi', op: 'lt', right: 70 }] } },
  exit: { long: { any: [{ left: 'close', op: 'crosses_below', right: 'bb.middle' }] } },
  risk: { stopPct: 2, targetPct: 4, maxBars: 48 }, plot: ['fast', 'bb'],
});
const mut = (fn) => { const s = base(); fn(s); return s; };
const rejects = (raw, pathPart) => {
  const r = parseSpec(raw);
  expect(r.ok).toBe(false);
  expect(r.issues.length).toBeGreaterThan(0);
  expect(r.issues.length).toBeLessThanOrEqual(20);
  if (pathPart) expect(r.issues.some((i) => i.path.includes(pathPart))).toBe(true);
  return r;
};

describe('spec schema', () => {
  test('valid spec parses', () => {
    const r = parseSpec(base());
    expect(r.ok).toBe(true);
    expect(parseSpec(JSON.stringify(base())).ok).toBe(true);
  });
  test('unknown key rejected without echoing it', () => {
    const r = rejects(mut((s) => { s.code = "fetch('//x')"; }));
    expect(JSON.stringify(r)).not.toMatch(/fetch|code/);
  });
  test('__proto__ and constructor keys rejected, no pollution', () => {
    const raw = JSON.stringify(base()).replace('{"version"', '{"__proto__":{"polluted":1},"version"');
    rejects(raw);
    expect({}.polluted).toBeUndefined();
    rejects(mut((s) => { s.constructor = { x: 1 }; }));
    rejects(mut((s) => { s.indicators[0].constructor = 1; }));
  });
  test('bounds', () => {
    rejects(mut((s) => { s.indicators[0].period = 10000; }), 'period');
    rejects(mut((s) => { s.indicators[0].period = 1; }), 'period');
    rejects(mut((s) => { s.indicators[0].period = 2.5; }), 'period');
    rejects(mut((s) => { s.indicators[3].stdDev = 9; }));
    rejects(mut((s) => { s.risk.stopPct = 0; }));
    rejects(mut((s) => { s.risk.maxBars = 501; }));
    rejects(mut((s) => { s.timeframe = '3m'; }));
  });
  test('9 indicators and 7 conditions rejected', () => {
    rejects(mut((s) => { s.indicators = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, type: 'sma', period: 5 })); }));
    rejects(mut((s) => { s.entry.long.all = Array.from({ length: 7 }, () => ({ left: 'close', op: 'gt', right: 1 })); }));
  });
  test('nested groups rejected', () => {
    rejects(mut((s) => { s.entry.long = { all: [{ all: [{ left: 'close', op: 'gt', right: 1 }] }] }; }));
    rejects(mut((s) => { s.entry.long = { all: [{ left: 'close', op: 'gt', right: 1 }], any: [{ left: 'close', op: 'gt', right: 1 }] }; }));
  });
  test('refs must resolve; expression operand and bad op rejected', () => {
    rejects(mut((s) => { s.entry.long.all[0].right = 'nope'; }), 'right');
    rejects(mut((s) => { s.entry.long.all[0].left = 'bb'; }), 'left'); // multi-output needs a field
    rejects(mut((s) => { s.entry.long.all[1].right = 'close*2'; }));
    rejects(mut((s) => { s.entry.long.all[1].right = { ref: 'close', mul: '2' }; }));
    rejects(mut((s) => { s.entry.long.all[1].op = 'eval'; }));
    rejects(mut((s) => { s.plot = ['nope']; }), 'plot');
    expect(parseSpec(mut((s) => { s.entry.long.all[1].right = { ref: 'close', mul: 1.01 }; })).ok).toBe(true);
  });
  test('1e309 and huge name rejected', () => {
    rejects(JSON.stringify(base()).replace('"period":14', '"period":1e309'));
    rejects(JSON.stringify(base()).replace('"stopPct":2', '"stopPct":1e309'));
    rejects(mut((s) => { s.name = 'x'.repeat(10000); }));
    rejects(mut((s) => { s.name = 'x'.repeat(61); }), 'name');
    rejects(mut((s) => { s.name = ''; }), 'name');
  });
  test('body over 4KB rejected before parsing (string and object)', () => {
    const pad = ' '.repeat(STRATEGY_LIMITS.maxBytes);
    const r = rejects(JSON.stringify(base()) + pad);
    expect(r.issues[0].message).toMatch(/too large/);
    rejects(mut((s) => { s.description = 'y'.repeat(300); s.indicators = Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, type: 'sma', source: 'close', period: 5 })); s.junk = 'z'.repeat(5000); }));
  });
  test('array root, non-JSON, homoglyph id rejected', () => {
    rejects([]);
    rejects('not json');
    rejects(null);
    rejects(mut((s) => { s.indicators[0].id = 'fаst'; }));
    rejects(mut((s) => { s.indicators[0].id = 'Fast'; }));
  });
  test('semantic: duplicate id, reserved id, macd order, direction vs groups', () => {
    rejects(mut((s) => { s.indicators[1].id = 'fast'; }), 'id');
    rejects(mut((s) => { s.indicators[1].id = 'close'; }), 'id');
    rejects(mut((s) => { s.indicators[4].fast = 26; }), 'fast');
    rejects(mut((s) => { s.direction = 'short'; }), 'direction');
    rejects(mut((s) => { s.direction = 'both'; }), 'direction');
    rejects(mut((s) => { s.entry = {}; }));
    rejects(mut((s) => { s.exit.short = { all: [{ left: 'close', op: 'gt', right: 1 }] }; }), 'exit');
  });
  test('S5: invisible/bidi Unicode (U+202E, zero-width, BOM) stripped from name and description', () => {
    const r = parseSpec(mut((s) => { s.name = 'Safe\u202Ename\u200B\u2066x\u2069\uFEFF'; s.description = 'd\u200Fe\u202Af'; }));
    expect(r.spec.name).toBe('Safenamex');
    expect(r.spec.description).toBe('def');
  });

  test('control chars stripped from name', () => {
    const r = parseSpec(mut((s) => { s.name = 'a\u0000b\u001bc'; }));
    expect(r.spec.name).toBe('abc');
  });
});

describe('indicators vs independent reference vectors', () => {
  const close = (got, want) => {
    expect(got.length).toBe(want.length);
    want.forEach((w, i) => (w === null ? expect(got[i]).toBeNull() : expect(got[i]).toBeCloseTo(w, 9)));
  };
  const candles = REF.c.map((c, i) => ({ time: i * H, open: c, high: REF.h[i], low: REF.l[i], close: c, volume: REF.v[i] }));
  test('sma', () => close(ind.sma(REF.c, 3), REF.sma3));
  test('ema seeded with sma', () => close(ind.ema(REF.c, 3), REF.ema3));
  test('rsi wilder', () => close(ind.rsi(REF.c, 5), REF.rsi5));
  test('atr wilder', () => close(ind.atr(candles, 5), REF.atr5));
  test('bollinger population sd', () => {
    const b = ind.bollinger(REF.c, 5, 2);
    close(b.middle, REF.bm); close(b.upper, REF.bu); close(b.lower, REF.bl);
  });
  test('macd', () => {
    const m = ind.macd(REF.c, 3, 6, 3);
    close(m.macd, REF.macd); close(m.signal, REF.sig); close(m.hist, REF.hist);
  });
  test('volume_sma via evaluate series', () => {
    const spec = { version: 1, name: 'v', timeframe: '1h', direction: 'long', indicators: [{ id: 'vavg', type: 'volume_sma', period: 3 }],
      entry: { long: { all: [{ left: 'volume', op: 'gt', right: 'vavg' }] } }, plot: ['vavg'] };
    const out = evaluate(spec, candles, { now: FAR });
    close(REF.v.map((_, i) => { const p = out.series.vavg.find((x) => x.time === i * H); return p ? p.value : null; }), REF.vsma);
  });
  test('null during warm-up', () => {
    expect(ind.sma(REF.c, 5).slice(0, 4)).toEqual([null, null, null, null]);
    expect(ind.rsi(REF.c, 5).slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(ind.rsi([1, 2], 5)).toEqual([null, null]);
  });
});

// deterministic PRNG so the random-future test is reproducible
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const walk = (n, r, start = 100, t0 = 0) => {
  let p = start; const out = [];
  for (let i = 0; i < n; i++) {
    const o = p; p = Math.max(1, p * (1 + (r() - 0.5) * 0.05));
    out.push({ time: t0 + i * H, open: o, high: Math.max(o, p) * (1 + r() * 0.01), low: Math.min(o, p) * (1 - r() * 0.01), close: p, volume: 100 + r() * 100 });
  }
  return out;
};

describe('evaluator / backtest', () => {
  const smaSpec = () => ({ version: 1, name: 'x', timeframe: '1h', direction: 'long',
    indicators: [{ id: 'ma', type: 'sma', period: 10 }, { id: 'r', type: 'rsi', period: 7 }],
    entry: { long: { any: [{ left: 'close', op: 'crosses_above', right: 'ma' }] } },
    exit: { long: { any: [{ left: 'close', op: 'crosses_below', right: 'ma' }] } },
    risk: { stopPct: 3, targetPct: 5, maxBars: 30 }, plot: ['ma', 'r'] });

  test('no look-ahead: prefix invariance with random future candles', () => {
    const r = rng(42);
    const all = walk(400, r);
    const n = 250;
    const a = evaluate(smaSpec(), all.slice(0, n), { now: FAR });
    expect(a.trades.length).toBeGreaterThan(3);
    for (let trial = 0; trial < 3; trial++) {
      const future = walk(60 + trial * 30, rng(trial + 7), all[n - 1].close, all[n - 1].time + H);
      const b = evaluate(smaSpec(), all.slice(0, n).concat(future), { now: FAR });
      const last = all[n - 1].time;
      expect(b.trades.filter((t) => t.exitTime <= last)).toEqual(a.trades);
      expect(b.markers.filter((m) => m.time < last)).toEqual(a.markers.filter((m) => m.time < last));
      for (const k of Object.keys(a.series)) expect(b.series[k].filter((p) => p.time <= last)).toEqual(a.series[k]);
    }
  });

  // signals driven by volume so fills are hand-controlled: >1000 enters, <100 exits
  const volSpec = (risk) => ({ version: 1, name: 'v', timeframe: '1h', direction: 'long', indicators: [],
    entry: { long: { all: [{ left: 'volume', op: 'gt', right: 1000 }] } },
    exit: { long: { all: [{ left: 'volume', op: 'lt', right: 100 }] } }, ...(risk ? { risk } : {}) });
  const bar = (i, open, close, volume, high = Math.max(open, close), low = Math.min(open, close)) => ({ time: i * H, open, high, low, close, volume });

  test('entry fills at next bar open; exact fee + slippage arithmetic on 2 trades', () => {
    const cs = [bar(0, 100, 100, 2000), bar(1, 100, 105, 500), bar(2, 105, 108, 50), bar(3, 110, 110, 2000),
      bar(4, 110, 105, 500), bar(5, 105, 100, 50), bar(6, 99, 99, 500), bar(7, 99, 99, 500)];
    const free = evaluate(volSpec(), cs, { now: FAR, slippagePct: 0, feePct: 0 });
    expect(free.trades.length).toBe(2);
    expect(free.trades[0].entryTime).toBe(cs[1].time);
    expect(free.trades[0].entryPrice).toBe(100);
    expect(free.trades[0].exitPrice).toBe(110);
    expect(free.trades[0].returnPct).toBeCloseTo(10, 10);
    expect(free.trades[1].returnPct).toBeCloseTo(-10, 10);
    expect(free.stats.totalReturnPct).toBeCloseTo(0, 6);

    const s = 0.1, f = 0.05;
    const costed = evaluate(volSpec(), cs, { now: FAR, slippagePct: s, feePct: f });
    const e1 = 100 * 1.001, x1 = 110 * 0.999, e2 = 110 * 1.001, x2 = 99 * 0.999;
    const t1 = (x1 / e1 - 1) * 100 - 2 * f, t2 = (x2 / e2 - 1) * 100 - 2 * f;
    expect(costed.trades[0].entryPrice).toBeCloseTo(e1, 10);
    expect(costed.trades[0].exitPrice).toBeCloseTo(x1, 10);
    expect(costed.trades[0].returnPct).toBeCloseTo(t1, 10);
    expect(costed.trades[1].returnPct).toBeCloseTo(t2, 10);
    expect(costed.stats.totalReturnPct).toBeCloseTo(t1 + t2, 3);
    expect(costed.stats.totalReturnPct).toBeLessThan(free.stats.totalReturnPct);
  });

  test('stop and target in the same candle => stop', () => {
    const cs = [bar(0, 100, 100, 2000), bar(1, 100, 100, 500, 103, 97), bar(2, 100, 100, 500), bar(3, 100, 100, 500)];
    const r = evaluate(volSpec({ stopPct: 2, targetPct: 2 }), cs, { now: FAR, slippagePct: 0, feePct: 0 });
    expect(r.trades[0].reason).toBe('stop');
    expect(r.trades[0].exitPrice).toBeCloseTo(98, 10);
    expect(r.markers.map((m) => m.kind)).toEqual(['entry_long', 'stop']);
  });

  test('S1: a stop the price gaps through fills at the gap open (long below, short above); a target keeps its price', () => {
    const lo = evaluate(volSpec({ stopPct: 2 }), [bar(0, 100, 100, 2000), bar(1, 100, 100, 500), bar(2, 90, 91, 500, 92, 89), bar(3, 91, 91, 500)], { now: FAR, slippagePct: 0, feePct: 0 });
    expect(lo.trades[0].reason).toBe('stop');
    expect(lo.trades[0].exitPrice).toBeCloseTo(90, 10); // stop 98, bar opens at 90
    expect(lo.trades[0].returnPct).toBeCloseTo(-10, 10);
    const spec = { version: 1, name: 's', timeframe: '1h', direction: 'short', indicators: [],
      entry: { short: { all: [{ left: 'volume', op: 'gt', right: 1000 }] } }, exit: { short: { all: [{ left: 'volume', op: 'lt', right: 100 }] } }, risk: { stopPct: 2 } };
    const sh = evaluate(spec, [bar(0, 100, 100, 2000), bar(1, 100, 100, 500), bar(2, 110, 109, 500, 111, 108), bar(3, 109, 109, 500)], { now: FAR, slippagePct: 0, feePct: 0 });
    expect(sh.trades[0].exitPrice).toBeCloseTo(110, 10); // stop 102, bar opens at 110
    const tg = evaluate(volSpec({ targetPct: 2 }), [bar(0, 100, 100, 2000), bar(1, 100, 100, 500), bar(2, 110, 111, 500, 112, 109), bar(3, 111, 111, 500)], { now: FAR, slippagePct: 0, feePct: 0 });
    expect(tg.trades[0].exitPrice).toBeCloseTo(102, 10); // gap past the target still fills at the target (pessimistic)
  });

  test('S4: a position still open on the last bar is reported separately and not counted in the stats', () => {
    const cs = [bar(0, 100, 100, 2000), bar(1, 100, 100, 500), bar(2, 100, 120, 500), bar(3, 120, 130, 500)];
    const r = evaluate(volSpec(), cs, { now: FAR, slippagePct: 0, feePct: 0 });
    expect(r.trades).toEqual([]);
    expect(r.stats).toMatchObject({ trades: 0, winRate: null, profitFactor: null, totalReturnPct: 0 });
    expect(r.stats.openTrade).toMatchObject({ side: 'long', entryPrice: 100, markPrice: 130, unrealisedPct: 30 });
    expect(r.markers.map((m) => m.kind)).toEqual(['entry_long', 'open_long']);
    expect(r.caveats.join(' ')).toMatch(/still open on the last candle/);
    const done = evaluate(volSpec(), [...cs, bar(4, 130, 130, 50), bar(5, 130, 130, 500)], { now: FAR, slippagePct: 0, feePct: 0 });
    expect(done.stats.openTrade).toBeNull();
    expect(done.caveats.join(' ')).not.toMatch(/still open/);
  });

  test('target and maxBars exits', () => {
    const t = evaluate(volSpec({ targetPct: 2 }), [bar(0, 100, 100, 2000), bar(1, 100, 100, 500), bar(2, 100, 103, 500, 103, 100), bar(3, 100, 100, 500)], { now: FAR, slippagePct: 0, feePct: 0 });
    expect(t.trades[0].reason).toBe('target');
    expect(t.trades[0].exitPrice).toBeCloseTo(102, 10);
    const m = evaluate(volSpec({ maxBars: 2 }), [bar(0, 100, 100, 2000), bar(1, 100, 101, 500), bar(2, 101, 104, 500), bar(3, 104, 104, 500)], { now: FAR, slippagePct: 0, feePct: 0 });
    expect(m.trades[0].reason).toBe('maxBars');
    expect(m.trades[0].exitPrice).toBe(104);
  });

  test('short side mirrors: profit when price falls', () => {
    const spec = { version: 1, name: 's', timeframe: '1h', direction: 'short', indicators: [],
      entry: { short: { all: [{ left: 'volume', op: 'gt', right: 1000 }] } }, exit: { short: { all: [{ left: 'volume', op: 'lt', right: 100 }] } } };
    const r = evaluate(spec, [bar(0, 100, 100, 2000), bar(1, 100, 95, 500), bar(2, 95, 90, 50), bar(3, 90, 90, 500)], { now: FAR, slippagePct: 0, feePct: 0 });
    expect(r.trades[0].side).toBe('short');
    expect(r.trades[0].returnPct).toBeCloseTo(10, 10);
  });

  test('open (still forming) last candle is excluded', () => {
    const cs = walk(60, rng(1));
    const lastT = cs[59].time;
    const open = evaluate(smaSpec(), cs, { now: (lastT + 10) * 1000 });
    expect(open.evaluatedThrough).toBe(cs[58].time);
    expect(open.stats.bars).toBe(59);
    const closed = evaluate(smaSpec(), cs, { now: (lastT + H) * 1000 });
    expect(closed.evaluatedThrough).toBe(lastT);
  });

  test('caveats fixed; small-sample caveat under 30 trades', () => {
    const r = evaluate(smaSpec(), walk(150, rng(3)), { now: FAR });
    expect(r.stats.trades).toBeLessThan(30);
    expect(r.caveats.some((c) => /Too few trades/.test(c))).toBe(true);
    expect(r.caveats.join(' ')).toMatch(/overfit/);
    expect(r.caveats.join(' ')).toMatch(/stop is assumed/);
    expect(r.caveats.join(' ')).toMatch(/Fees and slippage/);
  });

  test('no small-sample caveat from 30 trades up', () => {
    const r = evaluate(smaSpec(), walk(1000, rng(3)), { now: FAR });
    expect(r.stats.trades).toBeGreaterThanOrEqual(30);
    expect(r.caveats.some((c) => /Too few trades/.test(c))).toBe(false);
  });

  test('evaluate refuses an unvalidated spec; costs clamped; output bounded', () => {
    expect(() => evaluate({ version: 1, code: 'x' }, [], {})).toThrow('invalid_spec');
    const r = evaluate(smaSpec(), walk(80, rng(5)), { now: FAR, slippagePct: 99, feePct: -5 });
    expect(r.costs).toEqual({ slippagePct: 1, feePct: 0 });
    expect(evaluate(smaSpec(), [], { now: FAR }).stats.trades).toBe(0);
  });

  test('describe is generated from the spec', () => {
    const d = describeSpec(parseSpec(base()).spec);
    expect(d).toMatch(/long only on 1h/);
    expect(d).toMatch(/Enter long when fast crosses above slow AND rsi is below 70/);
    expect(d).toMatch(/stop loss 2%/);
  });
});

describe('source scan', () => {
  test('no eval / new Function / dynamic import in services/strategy', () => {
    const dir = path.join(__dirname, '../services/strategy');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/\beval\s*\(/);
      expect(src).not.toMatch(/new\s+Function/);
      expect(src).not.toMatch(/\bimport\s*\(/);
      expect(src).not.toMatch(/new\s+RegExp/);
    }
  });
});
