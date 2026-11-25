import { buildIndex, rankItems, suggestions, validRecents, addRecent } from './tokenSearch';

const perps = ['BTCUSDT', 'ETHUSDT', 'HUMAUSDT', 'SKYAIUSDT', 'HUMANUSDT', 'SHIBUSDT'];
const overview = [
  { symbol: 'BTCUSDT', quoteVolume: 900, priceChangePercent: 1 },
  { symbol: 'ETHUSDT', quoteVolume: 800, priceChangePercent: -9 },
  { symbol: 'HUMANUSDT', quoteVolume: 50, priceChangePercent: 2 },
];
const instruments = [{ symbol: 'RELIANCE', name: 'Reliance Industries', category: 'stock' }, { symbol: 'NIFTY50', name: 'Nifty 50', category: 'index' }, { symbol: 'GOLD', name: 'Gold', category: 'commodity' }];
const index = buildIndex({ perps, overview, coins: [{ symbol: 'btc', name: 'Bitcoin' }], instruments });
const syms = (q) => rankItems(index, q, new Map(overview.map((r) => [r.symbol.replace('USDT', ''), r.quoteVolume]))).map((i) => i.symbol);

test('ranking: exact, then prefix, then substring, then fuzzy', () => {
  expect(syms('huma')).toEqual(['HUMA', 'HUMAN']);
  expect(syms('bitcoin')[0]).toBe('BTC'); // name match
  expect(syms('an')).toEqual(['HUMAN', 'RELIANCE']); // substring: token before instrument
  expect(syms('shb')).toEqual(['SHIB']); // fuzzy subsequence needs 3+ chars
  expect(syms('zzz')).toEqual([]);
});

test('tokens missing from the overview are still findable', () => {
  expect(syms('skyai')).toEqual(['SKYAI']);
  expect(index.find((i) => i.symbol === 'SKYAI').perp).toBe(true);
});

test('instruments are indexed and findable by name', () => {
  expect(syms('reliance')).toEqual(['RELIANCE']);
  expect(syms('nifty')).toEqual(['NIFTY50']);
  expect(syms('gold')).toEqual(['GOLD']);
});

test('suggestions: recents first, then volume, then movers, no duplicates', () => {
  const s = suggestions(index, overview, [{ k: 'token', s: 'SKYAI' }, { k: 'token', s: 'BTC' }]);
  expect(s.map((i) => `${i.symbol}:${i.why}`)).toEqual(['SKYAI:Recent', 'BTC:Recent', 'ETH:Volume', 'HUMAN:Volume']);
});

test('recents validation and cap', () => {
  expect(validRecents([{ k: 'token', s: 'BTC' }])).toBe(true);
  expect(validRecents([{ k: 'x', s: 'BTC' }])).toBe(false);
  expect(validRecents([{ k: 'token', s: '<b>' }])).toBe(false);
  expect(validRecents('nope')).toBe(false);
  let l = [];
  ['A', 'B', 'C', 'D', 'E', 'F', 'A'].forEach((s) => { l = addRecent(l, 'token', s); });
  expect(l.map((r) => r.s)).toEqual(['A', 'F', 'E', 'D', 'C']);
});
