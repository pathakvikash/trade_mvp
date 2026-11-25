import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LiqMap from './LiqMap';
import usePolling from '../../lib/usePolling';

jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./useCanvas', () => ({ __esModule: true, default: () => ({ wrap: { current: null }, canvas: { current: null } }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;
const DATA = { symbol: 'BTCUSDT', price: 100, generatedAt: 1700000000000, method: 'm', levels: [{ price: 90, longUsd: 5, shortUsd: 0 }, { price: 110, longUsd: 0, shortUsd: 7 }] };

test('a failed refresh keeps the map and shows a refresh-failed note with the data time', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  usePolling.mockReturnValue({ data: DATA, error: new Error('x'), loading: false, source: null });
  act(() => root.render(<LiqMap symbol="BTCUSDT" />));
  expect(container.querySelector('canvas')).not.toBeNull();
  expect(container.querySelector('[role="status"]').textContent).toMatch(/Showing data from \d{1,2}:\d{2}.*: refresh failed/);
  usePolling.mockReturnValue({ data: DATA, error: null, loading: false, source: null });
  act(() => root.render(<LiqMap symbol="BTCUSDT" />));
  expect(container.querySelector('[role="status"]')).toBeNull();
  act(() => root.unmount());
});
