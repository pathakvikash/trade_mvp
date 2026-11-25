import { derivativesPulse, pickInstruments, liqView } from './dashboardStats';

const r = (symbol, o) => ({ symbol, quoteVolume: 100, priceChangePercent: 1, fundingRate: 0, openInterestUsd: 10, ...o });

test('derivativesPulse: OI excludes missing rows and counts them', () => {
  const p = derivativesPulse([r('A', { openInterestUsd: 100 }), r('B', { openInterestUsd: null }), r('C', { openInterestUsd: undefined }), r('D', { openInterestUsd: 50 })]);
  expect(p.oiUsd).toBe(150);
  expect(p.oiCount).toBe(2);
  expect(p.oiMissing).toBe(2);
  expect(derivativesPulse([r('A', { openInterestUsd: null })]).oiUsd).toBeNull();
});

test('derivativesPulse: volume-weighted funding, hot/cold counts, extremes', () => {
  const p = derivativesPulse([
    r('A', { fundingRate: 0.001, quoteVolume: 300 }),
    r('B', { fundingRate: -0.0005, quoteVolume: 100 }),
    r('C', { fundingRate: 0.0001, quoteVolume: 100 }),
    r('D', { fundingRate: null }),
  ]);
  expect(p.funding).toBeCloseTo((0.001 * 300 - 0.0005 * 100 + 0.0001 * 100) / 500, 10);
  expect(p.fundingCount).toBe(3);
  expect(p.hot).toBe(1);
  expect(p.cold).toBe(1);
  expect(p.mostPositive.map((x) => x.symbol)).toEqual(['A', 'C']);
  expect(p.mostNegative.map((x) => x.symbol)).toEqual(['B']);
});

test('derivativesPulse: breadth ignores flat/missing, caps at n, tolerates junk', () => {
  const p = derivativesPulse([r('A', { priceChangePercent: 2 }), r('B', { priceChangePercent: -1 }), r('C', { priceChangePercent: 0 }), r('D', { priceChangePercent: null })]);
  expect([p.up, p.down, p.moveCount]).toEqual([1, 1, 3]);
  expect(derivativesPulse([r('A'), r('B'), r('C')], 2).count).toBe(2);
  const e = derivativesPulse(null);
  expect([e.count, e.oiUsd, e.funding]).toEqual([0, null, null]);
});

test('pickInstruments keeps order and skips missing', () => {
  const rows = [{ symbol: 'GOLD' }, { symbol: 'NIFTY50' }, { symbol: 'X' }];
  expect(pickInstruments(rows).map((x) => x.symbol)).toEqual(['NIFTY50', 'GOLD']);
  expect(pickInstruments(undefined)).toEqual([]);
});

test('liqView totals and largest events', () => {
  const v = liqView({ windows: { '1h': { longUsd: 3, shortUsd: 1, count: 4 }, '24h': { longUsd: 10, shortUsd: 20 } }, recent: [{ usd: 5 }, { usd: 50 }, { usd: 'x' }] }, 2);
  expect(v.h1).toEqual({ long: 3, short: 1, total: 4, count: 4 });
  expect(v.h24.total).toBe(30);
  expect(v.biggest.map((e) => e.usd)).toEqual([50, 5]);
  expect(liqView(null)).toEqual({ h1: null, h24: null, biggest: [] });
});
