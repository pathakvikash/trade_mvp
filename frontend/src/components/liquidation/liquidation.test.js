import { bucketLiquidations } from './bucket';
import { squarify } from './treemap';

const base = { t0: 0, t1: 1000, cols: 10, rows: 5 };

test('zero events: empty grid, no NaN', () => {
  const g = bucketLiquidations([], base);
  expect(g.count).toBe(0);
  expect(g.maxLong).toBe(0);
  expect(g.maxShort).toBe(0);
  expect(g.hi).toBeGreaterThan(g.lo);
  expect(Number.isFinite(g.lo)).toBe(true);
});

test('one event lands in one cell on the right side', () => {
  const g = bucketLiquidations([{ side: 'long', price: 100, usd: 500, ts: 250 }], base);
  expect(g.count).toBe(1);
  expect(g.longUsd).toBe(500);
  expect(g.shortUsd).toBe(0);
  expect(g.maxLong).toBe(500);
  expect(g.long.filter((v) => v > 0)).toHaveLength(1);
  expect(g.long[2 * 10 + 2]).toBe(500); // mid price row (padded band), ts 250 -> col 2
});

test('all same price stays in range and sums', () => {
  const ev = [
    { side: 'short', price: 50, usd: 10, ts: 0 },
    { side: 'short', price: 50, usd: 20, ts: 999 },
    { side: 'long', price: 50, usd: 5, ts: 1000 }, // t1 is exclusive
  ];
  const g = bucketLiquidations(ev, base);
  expect(g.count).toBe(2);
  expect(g.shortUsd).toBe(30);
  expect(g.maxShort).toBe(20);
});

test('squarify fills the box', () => {
  const r = squarify([{ value: 6 }, { value: 3 }, { value: 2 }, { value: 1 }], 100, 60);
  expect(r).toHaveLength(4);
  expect(r.reduce((s, c) => s + c.w * c.h, 0)).toBeCloseTo(6000, 3);
});
