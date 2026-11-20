import { filterPairs } from './pairs';

const P = (base) => ({ symbol: `${base}USDT`, base });

test('filterPairs: prefix matches before substring, volume order with no query, capped at 50', () => {
  const all = ['BTC', 'WBTC', 'ETH', 'SOL'].map(P);
  expect(filterPairs(all, 'btc', new Map()).map((p) => p.base)).toEqual(['BTC', 'WBTC']);
  expect(filterPairs(all, '', new Map([['SOLUSDT', { quoteVolume: 9 }]]))[0].base).toBe('SOL');
  expect(filterPairs(all, 'zzz', new Map())).toEqual([]);
  expect(filterPairs(Array.from({ length: 80 }, (_, i) => P(`A${i}`)), '', new Map())).toHaveLength(50);
});
