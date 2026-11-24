import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Stocks from './Stocks';
import usePolling from '../lib/usePolling';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('lightweight-charts', () => ({ createChart: jest.fn() }));
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../components/trade/CandleChart', () => ({ __esModule: true, default: () => <div>candles</div> }));

const ROWS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', currency: 'INR', price: 1234.5, changePct: 1.25, high: 1250, low: 1200, volume: 1234567, marketOpen: true, asOf: Date.UTC(2026, 10, 24, 4, 0) },
  { symbol: 'TCS', name: 'Tata Consultancy', exchange: 'NSE', currency: 'INR', price: 4000, changePct: -0.5, high: 4050, low: 3980, volume: 99, marketOpen: false, asOf: Date.UTC(2026, 10, 24, 10, 0), stale: true },
];
const ok = (data) => ({ data, error: null, loading: false });

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
const render = async (res) => {
  usePolling.mockImplementation((url) => (url.includes('/klines/') ? ok([{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }]) : res));
  await act(async () => { root.render(<Stocks />); });
  return container.textContent;
};

test('rows with INR, IST time, disclaimer, badges, no trade controls', async () => {
  const text = await render(ok({ disclaimer: 'Test disclaimer text', rows: ROWS }));
  expect(text).toContain('Test disclaimer text');
  expect(text).toContain('₹1,234.5');
  expect(text).toContain('09:30 IST');
  expect(text).toContain('+1.25%');
  expect(text).toContain('Open');
  expect(text).toContain('Closed');
  expect(text).toContain('Delayed data');
  expect(text).toContain('Paper trading for stocks is not available yet');
  expect(container.querySelector('form')).toBeNull();
  expect(text).not.toMatch(/\b(Buy|Sell|Long|Short)\b/);
});

test('fallback disclaimer when response has none', async () => {
  expect(await render(ok({ rows: ROWS }))).toContain('not investment advice');
});

test('filter narrows rows', async () => {
  await render(ok({ rows: ROWS }));
  const input = container.querySelector('input');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'tcs');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(container.textContent).toContain('Tata Consultancy');
  expect(container.textContent).not.toContain('Reliance Industries');
});

test('row click opens candle panel', async () => {
  await render(ok({ rows: ROWS }));
  await act(async () => { container.querySelector('tbody button').click(); });
  expect(container.textContent).toContain('candles');
});

test('error state with retry, never blank', async () => {
  const text = await render({ data: null, error: new Error('x'), loading: false });
  expect(text).toContain('unavailable');
  expect(text).toContain('Retry');
  expect(text).toContain('Stocks');
});

test('loading shows skeletons', async () => {
  await render({ data: null, error: null, loading: true });
  expect(container.querySelector('[aria-label="Loading stocks"]')).not.toBeNull();
});

test('timeframe switch never draws the previous timeframe candles', async () => {
  const stale = { symbol: 'RELIANCE', interval: '1d', candles: [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }] };
  usePolling.mockImplementation((url) => (url.includes('/klines/') ? ok(stale) : ok({ rows: ROWS })));
  await act(async () => { root.render(<Stocks />); });
  await act(async () => { container.querySelector('tbody button').click(); });
  expect(container.textContent).toContain('candles');
  const tab5 = [...container.querySelectorAll('button')].find((b) => b.textContent === '5m');
  await act(async () => { tab5.click(); });
  expect(container.textContent).toContain('Loading candles');
  expect(container.textContent.replace('Loading candles', '')).not.toContain('candles');
});

test('quotes poll asks usePolling to auto-retry while there is no data', async () => {
  await render({ data: null, error: new Error('x'), loading: false });
  const call = usePolling.mock.calls.find(([u]) => u.endsWith('/stocks/quotes'));
  expect(call[4]).toBe(true);
  expect(container.textContent).toContain('Retry');
});

test('phone list: tappable rows with price, change and status; tap opens the chart and scrolls it into view', async () => {
  const spy = jest.fn();
  Element.prototype.scrollIntoView = spy;
  await render(ok({ rows: ROWS }));
  const list = container.querySelector('ul');
  expect(list.className).toContain('sm:hidden');
  expect(container.querySelector('table').parentElement.className).toContain('hidden');
  expect(list.textContent).toContain('+1.25%');
  expect(list.textContent).toContain('Open');
  await act(async () => { list.querySelector('button').click(); });
  expect(container.textContent).toContain('candles');
  expect(container.textContent).toContain('Close');
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
  delete Element.prototype.scrollIntoView;
});
