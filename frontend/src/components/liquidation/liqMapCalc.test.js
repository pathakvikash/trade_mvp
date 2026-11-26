import { buildMap, liqStats, tiersOf, viewForRange } from './liqMapCalc';

const TIERS = [{ id: 'a', label: '<=10x' }, { id: 'b', label: '25x' }];
const LEVELS = [
  { price: 90, longUsd: 30, shortUsd: 0, longTier: [10, 20], shortTier: [0, 0] },
  { price: 98, longUsd: 6, shortUsd: 0, longTier: [4, 2], shortTier: [0, 0] },
  { price: 101, longUsd: 0, shortUsd: 8, longTier: [0, 0], shortTier: [3, 5] },
  { price: 120, longUsd: 0, shortUsd: 40, longTier: [0, 0], shortTier: [40, 0] },
];

test('tier grouping: per-tier arrays kept, disabled tier removed from bars and totals', () => {
  const all = buildMap(LEVELS, 100, TIERS);
  expect(all.rows[0].long).toEqual([10, 20]);
  expect(all.totalLong).toBe(36);
  expect(all.totalShort).toBe(48);
  const noB = buildMap(LEVELS, 100, TIERS, { b: false });
  expect(noB.rows[0].long).toEqual([10, 0]);
  expect(noB.totalLong).toBe(14);
  expect(noB.totalShort).toBe(43);
});

test('old payloads without tiers fall back to one All tier', () => {
  const t = tiersOf({});
  expect(t).toEqual([{ id: 'all', label: 'All' }]);
  const m = buildMap([{ price: 90, longUsd: 5, shortUsd: 0 }, { price: 110, longUsd: 0, shortUsd: 7 }], 100, t);
  expect(m.totalLong).toBe(5);
  expect(m.totalShort).toBe(7);
});

test('cumulative long falls toward the price from the left, cumulative short rises from the price to the right', () => {
  const m = buildMap(LEVELS, 100, TIERS);
  expect(m.rows.map((r) => r.cumLong)).toEqual([36, 6, 0, 0]);
  expect(m.rows.map((r) => r.cumShort)).toEqual([0, 0, 8, 48]);
  expect(m.maxCum).toBe(48);
  expect(m.maxBar).toBe(40);
});

test('stat cards: 2% windows, biggest cluster with distance, long/short ratio', () => {
  const s = liqStats(buildMap(LEVELS, 100, TIERS), 100);
  expect(s.longNear).toBe(6); // 98 is within 2%, 90 is not
  expect(s.shortNear).toBe(8);
  expect(s.cluster).toEqual({ price: 120, usd: 40, distPct: 20, side: 'short' });
  expect(s.ratio).toBeCloseTo(36 / 48);
});

test('range chip maps to a zoom view around the price, All = full range', () => {
  expect(viewForRange(null, 100, 85, 115)).toEqual({ k: 1, ox: 0, oy: 0 });
  const v = viewForRange(0.05, 100, 85, 115);
  expect(v.k).toBeCloseTo(3);
  expect(v.ox).toBeCloseTo(0.333, 2);
  expect(viewForRange(0.5, 100, 85, 115).k).toBe(1);
});
