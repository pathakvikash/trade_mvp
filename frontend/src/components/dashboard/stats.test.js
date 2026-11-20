import { allocation, breadth, fundingExtremes, fundingSplit, moverList, oiShare, topMovers, totalOi, valueHoldings, weightedFunding } from './stats';

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

test('breadth counts risers among the top-n perps by volume', () => {
  const r = [
    { symbol: 'A', priceChangePercent: 2, quoteVolume: 500 },
    { symbol: 'B', priceChangePercent: -1, quoteVolume: 400 },
    { symbol: 'C', priceChangePercent: 3, quoteVolume: 100 },
    { symbol: 'D', priceChangePercent: 1, quoteVolume: null },
  ];
  expect(breadth(r, 2)).toEqual({ up: 1, total: 2 }); // A up, B down
  expect(breadth(r)).toEqual({ up: 2, total: 3 }); // D has no volume, so it is skipped
  expect(breadth([])).toEqual({ up: 0, total: 0 });
});

test('fundingSplit counts positive, negative and zero funding', () => {
  expect(fundingSplit(rows)).toEqual({ pos: 2, neg: 1, zero: 0, total: 3 });
  expect(fundingSplit([{ symbol: 'X', fundingRate: null }]).total).toBe(0);
});

test('oiShare totals positive open interest and reports the top shares', () => {
  const s = oiShare(rows, 3);
  expect(s.total).toBe(10);
  expect(s.top).toEqual([{ symbol: 'A', usd: 10, share: 1 }]);
});

test('moverList returns the right ordering for each tab', () => {
  expect(moverList(rows, 'gainers', 1)[0].symbol).toBe('A');
  expect(moverList(rows, 'losers', 1)[0].symbol).toBe('B');
  expect(moverList(rows, 'volume', 1)[0].symbol).toBe('B');
  expect(moverList(rows, 'funding', 1)[0].symbol).toBe('A');
  expect(moverList(rows, 'unknown')).toEqual([]);
});

test('valueHoldings values at the live price and nulls totals when a price is missing', () => {
  const px = [{ symbol: 'BTCUSDT', lastPrice: 150 }];
  const v = valueHoldings([{ symbol: 'BTC', amount: 2, avgCost: 100 }], px);
  expect(v.value).toBe(300);
  expect(v.pnl).toBe(100);
  expect(v.pnlPct).toBeCloseTo(50); // cost 200, pnl 100
  const missing = valueHoldings([{ symbol: 'BTC', amount: 2, avgCost: 100 }, { symbol: 'XYZ', amount: 1, avgCost: 5 }], px);
  expect(missing.value).toBeNull();
  expect(missing.pnl).toBeNull();
  expect(missing.items[1].value).toBeNull();
  expect(valueHoldings([], px).value).toBe(0);
});

test('allocation shares include cash and sort holdings by value', () => {
  const a = allocation(100, [{ symbol: 'ETH', value: 100 }, { symbol: 'BTC', value: 300 }, { symbol: 'X', value: null }]);
  expect(a.total).toBe(500);
  expect(a.cash).toBe(100);
  expect(a.items.map((i) => i.symbol)).toEqual(['BTC', 'ETH']);
  expect(a.items[0].share).toBeCloseTo(0.6);
  expect(allocation(0, []).total).toBe(0);
});
