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
