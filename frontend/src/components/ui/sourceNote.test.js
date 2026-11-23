import { sourceNote } from './sourceNote';

test('maps providers per context and keeps the bybit wording', () => {
  expect(sourceNote('gate')).toBe('Candles from Gate perpetuals (Binance futures history unavailable from this server)');
  expect(sourceNote('bybit', 'priceLine')).toBe('Price line uses Bybit perpetual candles (Binance futures history unavailable from this server).');
  expect(sourceNote('mexc', 'heatmap')).toContain('Estimated from MEXC perpetuals data');
  expect(sourceNote('bitget', 'positioning')).toContain('are from Bitget');
  expect(sourceNote('spot')).toMatch(/^Spot candles/);
  expect(sourceNote('ws', 'oi')).toContain('Bybit perpetuals open interest');
  expect(sourceNote('unavailable', 'oi')).toBe('Open interest unavailable from this server');
  expect(sourceNote('binance-futures')).toBe('');
  expect(sourceNote(null, 'heatmap')).toBe('');
});
