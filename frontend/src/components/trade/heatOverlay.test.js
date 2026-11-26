import { heatRect, linearMap } from './heatOverlay';

const d = { t0: 1000, colMs: 100, cols: 10, priceMin: 50, priceStep: 10, rows: 10 }; // t 1000..2000, price 50..150
const xOf = linearMap(1000, 0, 2000, 500); // 0.5 px per ms
const yOf = linearMap(50, 400, 150, 0); // price up = y down

test('linearMap interpolates, extrapolates and returns null for a missing/degenerate anchor', () => {
  expect(xOf(1500)).toBe(250);
  expect(xOf(3000)).toBe(1000);
  expect(linearMap(1, null, 2, 3)).toBeNull();
  expect(linearMap(1, NaN, 2, 3)).toBeNull();
  expect(linearMap(5, 1, 5, 9)).toBeNull();
});

test('heatRect: whole grid inside the plot maps 1:1', () => {
  expect(heatRect(d, xOf, yOf, 600, 500)).toEqual({ sx: 0, sy: 0, sw: 10, sh: 10, dx: 0, dy: 0, dw: 500, dh: 400 });
});

test('heatRect clips to the plot and keeps the source window in step', () => {
  // plot only 250 px wide (half the time) and 200 px tall (top half of the prices = rows 5..9 -> bitmap rows 0..4)
  const r = heatRect(d, xOf, yOf, 250, 200);
  expect(r).toMatchObject({ sx: 0, sy: 0, sw: 5, sh: 5, dx: 0, dy: 0, dw: 250, dh: 200 });
});

test('heatRect: grid scrolled partly off the left edge starts mid-bitmap', () => {
  const shifted = linearMap(1000, -100, 2000, 400); // grid starts 100px left of the plot
  const r = heatRect(d, shifted, yOf, 600, 500);
  expect(r.dx).toBe(0);
  expect(r.sx).toBeCloseTo(2); // 100px of 500 = 2 columns
  expect(r.dw).toBe(400);
});

test('heatRect: null when entirely outside, or an axis is missing', () => {
  expect(heatRect(d, linearMap(1000, 700, 2000, 1200), yOf, 600, 500)).toBeNull();
  expect(heatRect(d, null, yOf, 600, 500)).toBeNull();
  expect(heatRect(d, xOf, yOf, 0, 500)).toBeNull();
  expect(heatRect(null, xOf, yOf, 600, 500)).toBeNull();
});
