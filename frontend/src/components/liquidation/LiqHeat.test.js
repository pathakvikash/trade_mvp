import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LiqHeat from './LiqHeat';

jest.mock('../../lib/usePolling', () => ({
  __esModule: true,
  default: () => ({ data: { cols: 0, max: 800, candles: [] }, error: null, loading: false, fetching: false, source: null }),
}));
jest.mock('./LiqHeatmap', () => ({ __esModule: true, default: () => null, RANGES: [{ id: '24h', label: '24h' }] }));
jest.mock('./LiqSide', () => ({ KeyLevels: () => null, Overview: () => null }));

global.IS_REACT_ACT_ENVIRONMENT = true;

test('the floating legend is mounted with the heatmap and can be opened', () => {
  localStorage.clear();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<LiqHeat symbol="BTCUSDT" />));
  const fab = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Legend');
  expect(fab).toBeTruthy();
  act(() => fab.click());
  expect(container.querySelector('[role="region"][aria-label="Heatmap legend"]')).not.toBeNull();
  act(() => root.unmount());
  container.remove();
});
