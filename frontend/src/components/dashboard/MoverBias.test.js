import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import MoverBias from './MoverBias';
import usePolling from '../../lib/usePolling';
import useAgentStore from '../../store/agentStore';

jest.mock('react-router-dom', () => {
  const h = require('react').createElement;
  return { Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children) };
}, { virtual: true });
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

const rows = [
  { symbol: 'AAAUSDT', lastPrice: 100, priceChangePercent: 18, fundingRate: 0.0009 },
  { symbol: 'MIDUSDT', lastPrice: 5, priceChangePercent: 1, fundingRate: 0 },
  { symbol: 'ZZZUSDT', lastPrice: 10, priceChangePercent: -12, fundingRate: -0.0008 },
];
const oi = (a, b) => Array.from({ length: 24 }, (_, i) => ({ oiUsd: a + ((b - a) * i) / 23 }));
const statsOk = { data: { openInterest: oi(100, 90), longShort: [{ ratio: 2.4 }] }, loading: false, error: null };
const liqOk = { data: { price: 100, levels: [{ price: 99, longUsd: 5, shortUsd: 0 }, { price: 104, longUsd: 0, shortUsd: 1 }] }, loading: false, error: null };

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
const render = (p) => act(async () => { root.render(<MoverBias {...p} />); });

test('renders gainer and loser cards with bias, reasons, invalidation, disclaimer', async () => {
  usePolling.mockImplementation((url) => (url.includes('/stats/') ? statsOk : liqOk));
  await render({ rows, loading: false, failed: false });
  const t = container.textContent;
  expect(t).toContain('Top gainer');
  expect(t).toContain('AAA');
  expect(t).toContain('Top loser');
  expect(t).toContain('ZZZ');
  expect(t).toMatch(/Bias: (Long|Short|Wait)/);
  expect(t).toContain('Invalidation:');
  expect(t).toContain('How this is computed');
  expect(t).toContain('Analysis only, not financial advice. Paper trading.');
  expect(usePolling.mock.calls.every(([, ms]) => ms === 60000)).toBe(true);
  expect(usePolling).toHaveBeenCalledWith(expect.stringMatching(/\/stats\/AAAUSDT\?period=1h$/), 60000);
  expect(usePolling).toHaveBeenCalledWith(expect.stringMatching(/\/liqmap\/ZZZUSDT$/), 60000);
});

test('links to Trade and Ask AI why opens the dock with page dashboard', async () => {
  usePolling.mockImplementation((url) => (url.includes('/stats/') ? statsOk : liqOk));
  await render({ rows, loading: false, failed: false });
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(['/trade?symbol=AAA', '/trade?symbol=ZZZ']);
  const spy = jest.spyOn(useAgentStore.getState(), 'openWith').mockImplementation(() => {});
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Ask AI why');
  act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(spy).toHaveBeenCalledWith({ kind: 'perp', symbol: 'AAAUSDT', page: 'dashboard', interval: undefined });
});

test('missing stats and liqmap: Wait with data-missing chips, no invented data', async () => {
  usePolling.mockReturnValue({ data: null, loading: false, error: new Error('x') });
  await render({ rows, loading: false, failed: false });
  const t = container.textContent;
  expect(t).toContain('Bias: Wait');
  expect(t).toContain('data missing: open interest');
  expect(t).toContain('data missing: liquidation map (estimate)');
});

test('skeleton while overview loads, error state when it failed', async () => {
  usePolling.mockReturnValue({ data: null, loading: true, error: null });
  await render({ rows: [], loading: true, failed: false });
  expect(container.textContent).toContain('Loading movers');
  await render({ rows: [], loading: false, failed: true });
  expect(container.textContent).toContain('Market data unavailable, retrying.');
});

test('skeleton inside a card while its stats load', async () => {
  usePolling.mockReturnValue({ data: null, loading: true, error: null });
  await render({ rows, loading: false, failed: false });
  expect(container.textContent).toContain('Loading bias');
});
