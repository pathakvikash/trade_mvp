import { describeAlert, emptyForm, validateAlert } from './alertLogic';

test('describeAlert reads like a sentence', () => {
  expect(describeAlert({ symbol: 'ETHUSDT', metric: 'funding', op: 'above', value: 0.05 })).toBe('ETHUSDT funding above 0.05%');
  expect(describeAlert({ symbol: 'BTCUSDT', metric: 'price', op: 'below', value: 70000 })).toBe('BTCUSDT price below $70,000');
  expect(describeAlert({ symbol: 'SOLUSDT', metric: 'liq_usd_5m', op: 'above', value: 1000000 })).toBe('SOLUSDT liquidations (5m) above $1,000,000');
});

test('validateAlert', () => {
  const ok = { ...emptyForm(), value: '70000' };
  expect(validateAlert(ok, 0, ['BTCUSDT'])).toEqual({});
  expect(validateAlert({ ...ok, value: '' }).value).toBeTruthy();
  expect(validateAlert({ ...ok, value: '-1' }).value).toBeTruthy();
  expect(validateAlert({ ...ok, metric: 'funding', value: '-0.02' })).toEqual({});
  expect(validateAlert({ ...ok, symbol: 'XXX' }, 0, ['BTCUSDT']).symbol).toBeTruthy();
  expect(validateAlert({ ...ok, cooldownMin: '1.5' }).cooldownMin).toBeTruthy();
  expect(validateAlert(ok, 20).form).toBeTruthy();
});

test('validateAlert: at most 5 distinct symbols', () => {
  const f = { symbol: 'NEWUSDT', metric: 'price', op: 'above', value: '1', cooldownMin: '15' };
  const used = ['A', 'B', 'C', 'D', 'E'].map((s) => `${s}USDT`);
  expect(validateAlert(f, 5, [], used).symbol).toBeTruthy();
  expect(validateAlert({ ...f, symbol: 'AUSDT' }, 5, [], used).symbol).toBeUndefined();
});
