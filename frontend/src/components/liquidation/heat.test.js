import { cellAt, heatColor, niceTicks, scaleT, timeTicks } from './heat';

test('heatColor runs dark purple to yellow and clamps', () => {
  expect(heatColor(0)).toEqual([68, 1, 84]);
  expect(heatColor(1)).toEqual([253, 231, 37]);
  expect(heatColor(-3)).toEqual(heatColor(0));
  expect(heatColor(NaN)).toEqual(heatColor(0));
  const mid = heatColor(0.5);
  expect(mid[1]).toBeGreaterThan(heatColor(0)[1]); // green channel rises toward the middle
});

test('scaleT is linear between bottom and top, clamped, and 1 for an empty range', () => {
  expect(scaleT(50, 0, 100)).toBe(0.5);
  expect(scaleT(5, 10, 20)).toBe(0);
  expect(scaleT(30, 10, 20)).toBe(1);
  expect(scaleT(7, 5, 5)).toBe(1);
});

test('cellAt maps plot fractions to column and price row (row 0 = bottom)', () => {
  const d = { cols: 4, rows: 2, t0: 1000, colMs: 100, priceMin: 10, priceStep: 5, cells: [1, 2, 3, 4, 5, 6, 7, 8] };
  expect(cellAt(d, 0.1, 0.9)).toEqual({ col: 0, row: 0, time: 1000, priceLo: 10, priceHi: 15, usd: 1 });
  expect(cellAt(d, 0.8, 0.1)).toMatchObject({ col: 3, row: 1, time: 1300, priceLo: 15, usd: 8 });
  expect(cellAt(d, 1, 0.5)).toBeNull();
  expect(cellAt(d, -0.1, 0.5)).toBeNull();
  expect(cellAt({ cols: 0, rows: 0 }, 0.5, 0.5)).toBeNull();
});

test('niceTicks are round and inside the range', () => {
  const t = niceTicks(61234, 66789, 5);
  expect(t.every((v) => v >= 61234 && v <= 66789 && v % 500 === 0)).toBe(true);
  expect(niceTicks(5, 5)).toEqual([]);
});

test('timeTicks align to the interval and keep the minimum gap', () => {
  const H = 3600e3;
  const ticks = timeTicks(0.5 * H, 24.5 * H, 960, 80, 0);
  expect(ticks.length).toBeGreaterThan(3);
  expect(ticks.every((k) => k.t % H === 0)).toBe(true);
  expect((ticks[1].x - ticks[0].x) * 960).toBeGreaterThanOrEqual(80);
  expect(timeTicks(0, 0, 100)).toEqual([]);
});
