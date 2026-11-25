import { PALETTES, buildCursor, cellAt, closeRow, heatColor, lensKeeps, niceTicks, rampCss, scaleT, sweptBetween, timeTicks } from './heat';

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

const D = () => {
  const d = { cols: 6, rows: 8, t0: 0, colMs: 300000, priceMin: 100, priceStep: 10, price: 145, cells: [], candles: [] };
  for (let c = 0; c < 6; c += 1) {
    d.candles.push({ open: 140, close: 143 + c });
    for (let r = 0; r < 8; r += 1) d.cells.push((c + 1) * 100 + r);
  }
  return d;
};

test('palettes: viridis stays the default look, the others differ and all are 9 stops', () => {
  expect(PALETTES.map((p) => p.id)).toEqual(['viridis', 'inferno', 'coolwarm']);
  expect(heatColor(0.5)).toEqual(heatColor(0.5, 'viridis'));
  expect(heatColor(0, 'inferno')).toEqual([0, 0, 4]);
  expect(heatColor(1, 'coolwarm')).not.toEqual(heatColor(1));
  expect(heatColor(0.3, 'unknown')).toEqual(heatColor(0.3));
  expect(rampCss('inferno')).toContain('rgb(0,0,4)');
});

test('close row and lenses split cells at the current price', () => {
  const d = D();
  expect(closeRow(d)).toBe(4);
  expect(lensKeeps(d, 'heat', 0)).toBe(true);
  expect(lensKeeps(d, 'long', 3)).toBe(true); // centre 135 < 145
  expect(lensKeeps(d, 'long', 5)).toBe(false); // centre 155
  expect(lensKeeps(d, 'short', 5)).toBe(true);
  expect(lensKeeps(d, 'short', 4)).toBe(false); // centre 145 is not above the price
});

test('sweptBetween sums one column between two rows, order-free and inclusive', () => {
  const d = D();
  expect(sweptBetween(d, 1, 2, 4)).toBe(202 + 203 + 204);
  expect(sweptBetween(d, 1, 4, 2)).toBe(609);
});

test('buildCursor: a 5x7 window around the cell with sides, from-price and swept', () => {
  const d = D();
  const c = buildCursor(d, 2, 6);
  expect(c.grid).toHaveLength(7);
  expect(c.grid[0]).toHaveLength(5);
  expect(c.grid[3][2]).toBe(306); // the cursor cell sits in the middle
  expect(c.grid[0][2]).toBe(null); // row 9 is outside the data
  expect(c.rowPrices[3]).toBe(165); // bucket middle
  expect(c.rowPrices[0]).toBe(null);
  expect(c.shorts).toBe(306);
  expect(c.longs).toBe(0);
  expect(c.rowShorts).toBe(305 + 306 + 307);
  expect(c.rowLongs).toBe(303 + 304); // rows 3 and 4 (centres 135, 145) are not above the price
  expect(c.fromPricePct).toBeCloseTo((165 / 145 - 1) * 100, 6);
  expect(c.swept).toBe(304 + 305 + 306);
  expect(c.close).toBe(145);
  expect(c.changePct).toBeCloseTo((5 / 140) * 100, 6);
  expect(c.msBeforeLatest).toBe(3 * 300000);
  expect(buildCursor(d, 9, 0)).toBeNull();
});

test('a level that was above the price then is still a short in its own column after the price rallied through it', () => {
  const d = D();
  d.price = 175; // rallied: row 6 (centre 165) is now below the last close
  d.candles[0].close = 130;
  d.candles[5].close = 175;
  expect(lensKeeps(d, 'short', 6, 0)).toBe(true); // 165 > 130 at the old column
  expect(lensKeeps(d, 'long', 6, 0)).toBe(false);
  expect(lensKeeps(d, 'long', 6, 5)).toBe(true); // below the close at the latest column
  expect(buildCursor(d, 0, 6).shorts).toBe(106);
  expect(buildCursor(d, 5, 6).longs).toBe(606);
});

test('buildCursor on an older column measures from-price and swept from that column\'s own close, not the latest price', () => {
  const d = D();
  d.candles[0].close = 130; // latest price stays 145
  const c = buildCursor(d, 0, 6);
  expect(c.close).toBe(130);
  expect(c.fromPricePct).toBeCloseTo((165 / 130 - 1) * 100, 6);
  expect(c.swept).toBe(103 + 104 + 105 + 106); // rows 3..6 of column 0
});
