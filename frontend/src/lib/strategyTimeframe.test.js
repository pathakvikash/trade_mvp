import strategyTimeframe from './strategyTimeframe';
import useStrategyStore from '../store/strategyStore';

const TFS = ['1m', '5m', '1h'];
const act = { kind: 'perp', symbol: 'BTCUSDT', interval: '1h', allTimeframes: false };
const ctx = { symbol: 'BTCUSDT', tfs: TFS, current: '5m' };

test('switches once; a remount (same active already applied) does not override the user', () => {
  expect(strategyTimeframe(act, null, ctx)).toBe('1h');
  useStrategyStore.getState().markApplied(act);
  expect(strategyTimeframe(act, useStrategyStore.getState().applied, ctx)).toBeNull();
  expect(strategyTimeframe({ ...act }, useStrategyStore.getState().applied, ctx)).toBe('1h'); // a new Show on chart
});

test('no switch for another symbol/kind, unknown timeframe, same timeframe or no strategy', () => {
  expect(strategyTimeframe({ ...act, symbol: 'ETHUSDT' }, null, ctx)).toBeNull();
  expect(strategyTimeframe({ ...act, kind: 'instrument' }, null, ctx)).toBeNull();
  expect(strategyTimeframe({ ...act, interval: '4h' }, null, ctx)).toBeNull();
  expect(strategyTimeframe(act, null, { ...ctx, current: '1h' })).toBeNull();
  expect(strategyTimeframe(null, null, ctx)).toBeNull();
});

test('clear forgets applied', () => {
  useStrategyStore.getState().markApplied(act);
  useStrategyStore.getState().clear();
  expect(useStrategyStore.getState().applied).toBeNull();
});

test('all-timeframes mode (flag true or absent on old data) never moves the chart', () => {
  expect(strategyTimeframe({ ...act, allTimeframes: true }, null, ctx)).toBeNull();
  const { allTimeframes, ...old } = act;
  expect(strategyTimeframe(old, null, ctx)).toBeNull();
});
