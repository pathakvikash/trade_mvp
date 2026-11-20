import { fundingExtremes, topMovers, totalOi, weightedFunding } from './stats';

const rows = [
  { symbol: 'A', priceChangePercent: 5, fundingRate: 0.0003, quoteVolume: 100, openInterestUsd: 10 },
  { symbol: 'B', priceChangePercent: -3, fundingRate: -0.0001, quoteVolume: 300, openInterestUsd: null },
  { symbol: 'C', priceChangePercent: 1, fundingRate: 0.0001, quoteVolume: 0 },
];

test('weightedFunding weights by volume and ignores zero/missing', () => {
  expect(weightedFunding(rows)).toBeCloseTo((0.0003 * 100 - 0.0001 * 300) / 400);
  expect(weightedFunding([])).toBeNull();
});

test('topMovers / fundingExtremes / totalOi', () => {
  const m = topMovers(rows, 1);
  expect(m.gainers[0].symbol).toBe('A');
  expect(m.losers[0].symbol).toBe('B');
  const f = fundingExtremes(rows, 1);
  expect(f.high[0].symbol).toBe('A');
  expect(f.low[0].symbol).toBe('B');
  expect(totalOi(rows)).toBe(10);
});
