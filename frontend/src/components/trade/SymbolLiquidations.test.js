import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import SymbolLiquidations from './SymbolLiquidations';
import usePolling from '../../lib/usePolling';

jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

const EVENTS = [
  { ts: 1000, symbol: 'BTCUSDT', side: 'long', price: 60000, qty: 1, usd: 60000 },
  { ts: 2000, symbol: 'BTCUSDT', side: 'short', price: 61000, qty: 2, usd: 122000 },
];

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

const render = async () => {
  await act(async () => { root.render(<SymbolLiquidations symbol="BTCUSDT" />); });
};

test('renders the newest sampled liquidations for the symbol, polled every 15s', async () => {
  usePolling.mockReturnValue({ data: { events: EVENTS, since: 1 }, error: null, loading: false });
  await render();

  expect(usePolling).toHaveBeenCalledWith(expect.stringMatching(/\/liquidations\/BTCUSDT$/), 15000);
  expect(container.textContent).toContain('Liquidations · BTC');
  expect(container.textContent).toContain('sampled');
  const rows = container.querySelectorAll('tbody tr');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Short');
  expect(rows[1].textContent).toContain('Long');
});

test('shows a skeleton while loading and a notice when nothing was sampled', async () => {
  usePolling.mockReturnValue({ data: null, error: null, loading: true });
  await render();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

  usePolling.mockReturnValue({ data: { events: [], since: 1 }, error: null, loading: false });
  await render();
  expect(container.textContent).toContain('No liquidations sampled yet for BTC');
});
