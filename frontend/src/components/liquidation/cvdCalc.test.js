import { cvdRead } from './cvdCalc';

// 8 candles: sellers early, buyers late. cvd is the running sum of delta.
const mk = (deltas) => { let c = 0; return deltas.map((d, i) => { c += d; return { close: 100 + i, buy: 10 + Math.max(d, 0), sell: 10 + Math.max(-d, 0), delta: d, cvd: c }; }); };

test('negative deltas: window read is sellers, latest quarter read is buyers, tail is the last 2 of 8', () => {
  const r = cvdRead(mk([-10, -10, -10, -10, -10, -10, 10, 10]));
  expect(r.net).toBe(-40);
  expect(r.label).toBe('sellers dominating');
  // tail = last 2 candles (floor(8/4)): delta 20 over volume 2*(10+10+10)=60 -> 33.3%
  expect(r.recent).toBeCloseTo((20 / 60) * 100, 6);
  expect(r.recentLabel).toBe('buyers dominating');
  expect(r.priceChange).toBeCloseTo(7, 6);
});

test('tail window is at least 2 candles and uses only the latest quarter', () => {
  const r = cvdRead(mk([5, 5, 5, -10])); // floor(4/4)=1 -> clamped to 2: deltas 5,-10
  expect(r.recent).toBeCloseTo((-5 / 55) * 100, 6);
  expect(r.recentLabel).toBe('sellers dominating');
});

test('too short or no volume gives null', () => {
  expect(cvdRead(mk([1]))).toBeNull();
  expect(cvdRead([{ buy: 0, sell: 0, delta: 0, cvd: 0, close: 1 }, { buy: 0, sell: 0, delta: 0, cvd: 0, close: 1 }])).toBeNull();
});

// ---- CVD tool maths ----
const { detectDivergences, cvdStats, spotVsFutures, buildLines, rebased, sliceView, filterTrades, thresholdLabel } = require('./cvdCalc');

// hand-made candles: delta d, price high/low/close given, cvd = running sum
const hc = (rows) => { let c = 0; return rows.map(([high, low, d], i) => { c += d; return { time: 60 * (i + 1), open: low, high, low, close: high, buy: 10 + Math.max(d, 0), sell: 10 + Math.max(-d, 0), delta: d, cvd: c }; }); };

test('bearish divergence: price makes a new high over the last 3 candles while cvd does not', () => {
  // highs 10,11,12 then 13 (new high); cvd 5,10,15 then 12 (below prior peak 15)
  const d = detectDivergences(hc([[10, 9, 5], [11, 10, 5], [12, 11, 5], [13, 12, -3]]), 3);
  expect(d).toEqual([{ time: 240, type: 'bearish', price: 13, cvd: 12, cvdDelta: -3 }]);
});

test('bullish divergence: new low in price, cvd holds above its prior low', () => {
  // lows 9,8,7 then 6; cvd -5,-10,-15 then -12 (above prior trough -15)
  const d = detectDivergences(hc([[10, 9, -5], [9, 8, -5], [8, 7, -5], [7, 6, 3]]), 3);
  expect(d).toEqual([{ time: 240, type: 'bullish', price: 6, cvd: -12, cvdDelta: 3 }]);
});

test('no divergence when cvd confirms the new high; a run of the same type yields one marker', () => {
  expect(detectDivergences(hc([[10, 9, 5], [11, 10, 5], [12, 11, 5], [13, 12, 5]]), 3)).toEqual([]);
  const run = detectDivergences(hc([[10, 9, 5], [11, 10, 5], [12, 11, 5], [13, 12, -3], [14, 13, -3]]), 3);
  expect(run.map((x) => x.time)).toEqual([240]); // candle 5 is the same run
  expect(detectDivergences(hc([[1, 1, 1]]), 3)).toEqual([]);
});

test('spotVsFutures describes who is buying or selling and who leads', () => {
  const f = { buy: 60, sell: 40, net: 20, share: 20 };
  const s = { buy: 40, sell: 60, net: -20, share: -20 };
  expect(spotVsFutures(f, s)).toEqual({ text: 'futures buying, spot selling', tag: 'Diverging' });
  expect(spotVsFutures(f, { ...f, share: 5 })).toMatchObject({ text: 'futures buying, spot buying', tag: 'Futures lead' });
  expect(spotVsFutures(f, { ...f, share: 30 }).tag).toBe('Spot lead');
  expect(spotVsFutures({ ...f, share: 1 }, { ...s, share: -1 })).toMatchObject({ text: 'futures flat, spot flat', tag: 'No clear lead' });
  expect(spotVsFutures(f, null).text).toMatch(/spot unavailable from this source/);
  expect(spotVsFutures(null, null)).toBeNull();
});

test('cvdStats: cards over the visible window only (cvd restarts at the view start)', () => {
  const fut = hc([[10, 9, 5], [11, 10, 5], [12, 11, -10], [13, 12, 20]]);
  const spot = hc([[10, 9, -2], [11, 10, -2], [12, 11, -2], [13, 12, -2]]);
  const all = cvdStats(fut, spot, null, 3);
  expect(all.fut.net).toBe(20);
  expect(all.spot.net).toBe(-8);
  const v = cvdStats(fut, spot, { from: 180, to: 240 }, 3); // last two candles
  expect(v.fut.net).toBe(10); // -10 + 20
  expect(v.takerBuyPct).toBeCloseTo(40 / 70 * 100, 6); // buy 10+30 of volume 20+30 + 40... = 70
  expect(v.price.last).toBe(13);
  expect(v.price.changePct).toBeCloseTo((13 / 12 - 1) * 100, 6);
  expect(v.lead.text).toBe('futures buying, spot selling');
  expect(cvdStats(fut, null, null, 3).spot).toBeNull();
});

test('buildLines: anchor at view start rebases to 0 and keeps whitespace before it; normalized lines peak at 1', () => {
  const fut = hc([[10, 9, 4], [11, 10, -2], [12, 11, 6], [13, 12, 2]]);
  const grid = fut.map((c) => c.time);
  const [l] = buildLines(fut, null, { show: 'vs', scale: 'abs', view: { from: 120, to: 240 }, anchor: 'view', grid });
  expect(l.data).toEqual([{ time: 60 }, { time: 120, value: -2 }, { time: 180, value: 4 }, { time: 240, value: 6 }]);
  const [n] = buildLines(fut, null, { show: 'vs', scale: 'norm', view: { from: 120, to: 240 }, anchor: 'view', grid });
  expect(Math.max(...n.data.filter((p) => p.value !== undefined).map((p) => Math.abs(p.value)))).toBe(1);
  const [w] = buildLines(fut, null, { show: 'fut', scale: 'abs', view: { from: 120, to: 240 }, anchor: 'window', grid });
  expect(w.data.map((p) => p.value)).toEqual([4, 2, 8, 10]);
});

test('buildLines show modes: vs gives two lines, combined sums futures and spot, a missing source draws nothing for it', () => {
  const fut = hc([[10, 9, 4], [11, 10, 2]]);
  const spot = hc([[10, 9, 1], [11, 10, -3]]);
  const grid = [60, 120];
  const o = { scale: 'abs', view: null, anchor: 'window', grid };
  expect(buildLines(fut, spot, { ...o, show: 'vs' }).map((l) => l.id)).toEqual(['fut', 'spot']);
  expect(buildLines(fut, spot, { ...o, show: 'combined' })[0].data.map((p) => p.value)).toEqual([5, 4]);
  expect(buildLines(fut, null, { ...o, show: 'vs' }).map((l) => l.id)).toEqual(['fut']);
  expect(buildLines(fut, null, { ...o, show: 'spot' })).toEqual([]);
  expect(buildLines(fut, null, { ...o, show: 'combined' })).toEqual([]);
});

test('helpers: rebased, sliceView, filterTrades, thresholdLabel', () => {
  const c = hc([[1, 1, 3], [1, 1, 4], [1, 1, -2]]);
  expect(rebased(sliceView(c, { from: 120, to: 180 })).map((x) => x.cvd)).toEqual([4, 2]);
  expect(filterTrades([{ usd: 5 }, { usd: 50 }], 10)).toEqual([{ usd: 50 }]);
  expect([10e3, 50e3, 100e3, 500e3, 1e6].map(thresholdLabel)).toEqual(['10K', '50K', '100K', '500K', '1M']);
});
