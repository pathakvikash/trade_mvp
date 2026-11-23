import { fmtMarketPrice, fmtPrice } from './fmt';

test('fmtMarketPrice trims trailing zeros and keeps separators', () => {
  expect(fmtMarketPrice(61207)).toBe('61,207');
  expect(fmtMarketPrice(57000)).toBe('57,000');
  expect(fmtMarketPrice(1.5)).toBe('1.5');
  expect(fmtMarketPrice(0.146916)).toBe('0.146916');
  expect(fmtMarketPrice(0.0037812)).toBe('0.0037812');
  expect(fmtMarketPrice(1234.56)).toBe('1,234.56');
  expect(fmtMarketPrice(100)).toBe('100');
  expect(fmtMarketPrice(null)).toBe('--');
});

test('money amounts keep fixed decimals via fmtPrice', () => {
  expect(fmtPrice(100000)).toBe('100,000.00');
});
