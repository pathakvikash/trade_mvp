import freshCandles from './freshCandles';

const c = [{ time: 1 }];
test('matching response and bare arrays pass, stale interval/symbol or junk give []', () => {
  expect(freshCandles({ symbol: 'TCS', interval: '1d', candles: c }, 'TCS', '1d')).toBe(c);
  expect(freshCandles(c, 'TCS', '1d')).toBe(c);
  expect(freshCandles({ symbol: 'TCS', interval: '1d', candles: c }, 'TCS', '5m')).toEqual([]);
  expect(freshCandles({ symbol: 'TCS', interval: '5m', candles: c }, 'INFY', '5m')).toEqual([]);
  expect(freshCandles(null, 'TCS', '5m')).toEqual([]);
});
