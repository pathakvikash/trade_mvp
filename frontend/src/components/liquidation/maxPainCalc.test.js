import { maxPain } from './maxPainCalc';

const lv = (price, usd) => ({ price, usd });
test('keeps the 3 largest per side, listed highest price first', () => {
  const r = maxPain({
    price: 100, largest: { price: 90, usd: 900, side: 'long' }, totals: { longUsd: 5, shortUsd: 6 },
    keyLevels: {
      above: [lv(105, 10), lv(110, 50), lv(120, 30), lv(115, 5), lv(130, 40)],
      below: [lv(95, 1), lv(90, 70), lv(80, 20), lv(85, 60), lv(70, 2)],
    },
  });
  expect(r.above.map((x) => x.price)).toEqual([130, 120, 110]); // usd 40, 30, 50 are the top 3
  expect(r.below.map((x) => x.price)).toEqual([90, 85, 80]);
  expect(r.pct).toBeCloseTo(-10, 6);
  expect(r.longUsd).toBe(5);
});

test('null without a positive largest bucket or price; fewer than 3 levels pass through', () => {
  expect(maxPain({ price: 100, largest: { price: 90, usd: 0 } })).toBeNull();
  expect(maxPain({ price: 0, largest: { price: 90, usd: 5 } })).toBeNull();
  const r = maxPain({ price: 100, largest: { price: 90, usd: 5, side: 'long' }, keyLevels: { above: [lv(101, 1), lv(102, 2)] } });
  expect(r.above.map((x) => x.price)).toEqual([102, 101]);
  expect(r.below).toEqual([]);
});
