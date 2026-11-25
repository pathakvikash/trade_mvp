import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import StrategyChip from './StrategyChip';
import useStrategyStore from '../../store/strategyStore';

global.IS_REACT_ACT_ENVIRONMENT = true;
let el; let root;
beforeEach(() => { el = document.createElement('div'); root = createRoot(el); useStrategyStore.setState({ active: { spec: {}, allTimeframes: true }, applied: null }); });
afterEach(() => act(() => root.unmount()));
const draw = (chip) => act(() => root.render(<StrategyChip chip={chip} />));

test('says Applied on all timeframes with the evaluated interval', () => {
  draw({ name: 'X', mode: 'all', designedOn: '1h', interval: '5m', trades: 3, winRate: 50 });
  expect(el.textContent).toContain('Applied on all timeframes');
  expect(el.textContent).toContain('3 trades on 5m');
  expect(el.textContent).toContain('results differ by timeframe');
});

test('says Pinned to 1h, toggle switches mode in the store, Clear removes it', () => {
  draw({ name: 'X', mode: 'pinned', designedOn: '1h', interval: '1h', trades: 1, winRate: null });
  expect(el.textContent).toContain('Pinned to 1h');
  const cb = el.querySelector('input[type="checkbox"]');
  expect(cb.checked).toBe(false);
  act(() => { cb.click(); });
  expect(useStrategyStore.getState().active.allTimeframes).toBe(true);
  act(() => { [...el.querySelectorAll('button')].find((b) => b.textContent === 'Clear').click(); });
  expect(useStrategyStore.getState().active).toBeNull();
});

test('unavailable and not-drawn states', () => {
  draw({ name: 'X', mode: 'all', designedOn: '1h', interval: '4h', unavailable: true });
  expect(el.textContent).toContain('Not available on this timeframe (4h)');
  draw({ name: 'X', mode: 'pinned', designedOn: '1h', interval: '5m', mismatch: 'Not drawn on 5m: pinned to 1h.' });
  expect(el.textContent).toContain('Not drawn on 5m');
});
