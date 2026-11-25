import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import RealMarkets from './RealMarkets';
import usePolling from '../../lib/usePolling';

// react-router-dom is not loadable under Jest; the page only needs useSearchParams, fed from mockQuery.
let mockQuery = '';
jest.mock('react-router-dom', () => ({ __esModule: true, useSearchParams: () => [new URLSearchParams(mockQuery), jest.fn()] }), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('lightweight-charts', () => ({ createChart: jest.fn() }));
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../trade/CandleChart', () => ({ __esModule: true, default: () => <div>candles</div> }));

const T = Date.UTC(2026, 10, 24, 4, 0);
const base = { exchange: 'X', asOf: T, high: 1, low: 1, volume: 1 };
const ROWS = {
  stock: [
    { ...base, symbol: 'RELIANCE', name: 'Reliance Industries', category: 'stock', currency: 'INR', price: 1234.5, changePct: 1.25, marketOpen: true },
    { ...base, symbol: 'TCS', name: 'Tata Consultancy', category: 'stock', currency: 'INR', price: 4000, changePct: -0.5, marketOpen: false, stale: true },
  ],
  index: [{ ...base, symbol: 'NIFTY50', name: 'NIFTY 50', category: 'index', currency: 'INR', price: 24500.5, changePct: 0.1, marketOpen: null }],
  commodity: [{ ...base, symbol: 'GOLD', name: 'Gold', category: 'commodity', currency: 'USD', price: 2650.4, changePct: 0.2, marketOpen: true }],
  currency: [
    { ...base, symbol: 'USDINR', name: 'USD/INR', category: 'currency', currency: 'INR', price: 84.1234, changePct: 0, marketOpen: true },
    { ...base, symbol: 'EURUSD', name: 'EUR/USD', category: 'currency', currency: 'USD', price: 1.0512, changePct: 0, marketOpen: true },
  ],
};
const ok = (data) => ({ data, error: null, loading: false });

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); mockQuery = ''; });

const render = async (res) => {
  usePolling.mockImplementation((url) => {
    if (!url) return ok(null);
    if (url.includes('/klines/')) return ok({ candles: [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }] });
    if (res) return res;
    return ok({ disclaimer: 'Test disclaimer', rows: ROWS[url.split('category=')[1]] });
  });
  await act(async () => { root.render(<RealMarkets />); });
};
const open = async () => { await act(async () => { container.querySelector('[aria-expanded]').click(); }); };
const tab = async (name) => {
  const b = [...container.querySelectorAll('[role=tab]')].find((x) => x.textContent === name);
  await act(async () => { b.click(); });
};
const urls = () => usePolling.mock.calls.map((c) => c[0]).filter(Boolean);

test('collapsed: no request, disclaimer visible, view only', async () => {
  await render();
  expect(urls()).toEqual([]);
  expect(container.textContent).toContain('not investment advice');
  expect(container.textContent).toContain('View only');
});

test('stock rows: INR, badges, stale, disclaimer, no trade controls', async () => {
  await render();
  await open();
  const t = container.textContent;
  expect(t).toContain('Test disclaimer');
  expect(t).toContain('₹1,234.5');
  expect(t).toContain('+1.25%');
  expect(t).toContain('09:30 IST');
  expect(t).toContain('Open');
  expect(t).toContain('Closed');
  expect(t).toContain('Delayed data');
  expect(container.querySelector('form')).toBeNull();
  expect(t).not.toMatch(/\b(Buy|Sell|Long|Short)\b/);
});

test('category tabs switch the request and formats', async () => {
  await render();
  await open();
  expect(urls().some((u) => u.endsWith('quotes?category=stock'))).toBe(true);
  await tab('Indices');
  expect(urls().some((u) => u.endsWith('quotes?category=index'))).toBe(true);
  expect(container.textContent).toContain('24,500.5');
  expect(container.textContent).not.toContain('₹24,500');
  expect(container.textContent).toContain('n/a');
  await tab('Gold & crude');
  expect(urls().some((u) => u.endsWith('quotes?category=commodity'))).toBe(true);
  expect(container.textContent).toContain('$2,650.4');
  await tab('Currency');
  expect(urls().some((u) => u.endsWith('quotes?category=currency'))).toBe(true);
  expect(container.textContent).toContain('84.12');
  expect(container.textContent).toContain('1.0512');
});

test('row click opens chart with maximise button', async () => {
  await render();
  await open();
  await act(async () => { container.querySelector('tbody button').click(); });
  expect(container.textContent).toContain('candles');
  expect(container.querySelector('[aria-label="Maximise chart"]')).not.toBeNull();
  expect(urls().some((u) => u.includes('/instruments/klines/RELIANCE?interval=1d&limit=200'))).toBe(true);
});

test('error state with retry; loading skeletons', async () => {
  await render({ data: null, error: new Error('x'), loading: false });
  await open();
  expect(container.textContent).toContain('unavailable');
  expect(container.textContent).toContain('Retry');
  expect(container.textContent).toContain('not investment advice');
  act(() => root.unmount());
  root = createRoot(container);
  await render({ data: null, error: null, loading: true });
  await open();
  expect(container.querySelector('[aria-label="Loading real markets"]')).not.toBeNull();
});

test('timeframe switch never draws the previous timeframe candles', async () => {
  usePolling.mockImplementation((url) => {
    if (!url) return ok(null);
    if (url.includes('/klines/')) return ok({ symbol: 'RELIANCE', interval: '1d', candles: [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }] });
    return ok({ rows: ROWS.stock });
  });
  await act(async () => { root.render(<RealMarkets />); });
  await open();
  await act(async () => { container.querySelector('tbody button').click(); });
  expect(container.textContent).toContain('candles');
  await tab('5m');
  expect(container.textContent).toContain('Loading candles');
  expect(container.textContent.replace('Loading candles', '')).not.toContain('candles');
});

test('phone list row opens the chart; the panel keeps a fixed-height, non-shrinking body and Close', async () => {
  const spy = jest.fn();
  Element.prototype.scrollIntoView = spy;
  await render();
  await open();
  const list = container.querySelector('ul.sm\\:hidden');
  expect(list.textContent).toContain('Reliance Industries');
  await act(async () => { list.querySelector('button').click(); });
  expect(container.textContent).toContain('candles');
  expect(container.textContent).toContain('Close');
  const body = container.querySelector('section section > div:last-child');
  expect(body.className).toContain('shrink-0');
  expect(spy).toHaveBeenCalled();
  delete Element.prototype.scrollIntoView;
});

test('?instrument= opens the panel on it and switches when the param changes while mounted', async () => {
  await render();
  expect(urls()).toEqual([]); // no param: stays closed
  mockQuery = 'category=index&instrument=NIFTY50';
  await act(async () => { root.render(<RealMarkets />); });
  expect(urls().some((u) => u.includes('category=index'))).toBe(true);
  expect(container.textContent).toContain('NIFTY50 · NIFTY 50');
  mockQuery = 'category=commodity&instrument=GOLD';
  await act(async () => { root.render(<RealMarkets />); });
  expect(container.textContent).toContain('GOLD · Gold');
});
