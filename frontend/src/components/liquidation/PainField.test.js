import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import PainField from './PainField';
import usePolling from '../../lib/usePolling';

jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const lvl = (price, pct, usd, sigma = 1, touchPct = 30) => ({ price, pct, usd, sigma, touchPct });
const rows = [
  { symbol: 'BTCUSDT', price: 100, quoteVolume: 9, below: lvl(99.5, -0.5, 500), above: lvl(104, 4, 100, 2, 5), longUsd: 700, shortUsd: 300 },
  { symbol: 'ETHUSDT', price: 10, quoteVolume: 8, below: lvl(9, -10, 50, 3, 1), above: lvl(10.1, 1, 900, 0.5, 60), longUsd: 100, shortUsd: 900 },
];
const body = (o = {}) => ({ window: '24h', top: 20, generatedAt: Date.now(), count: 2, skipped: 0, rows, ...o });
const heat = { cols: 5, price: 100, totals: { longUsd: 7, shortUsd: 3 }, keyLevels: { above: [{ price: 104, usd: 100, pct: 4 }], below: [{ price: 99.5, usd: 500, pct: -0.5 }] } };
const mock = (state) => usePolling.mockImplementation((url) => (url.includes('/maxpain') ? state : { data: heat }));

let c; let root;
beforeEach(() => { localStorage.clear(); c = document.createElement('div'); document.body.appendChild(c); root = createRoot(c); });
afterEach(() => { act(() => root.unmount()); c.remove(); });
const render = (p = {}) => act(() => root.render(<PainField symbol="BTCUSDT" {...p} />));
const btn = (t) => [...c.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
const bubbles = () => c.querySelectorAll('svg g[role="button"]');

test('cards, bubbles, honest copy, default selection is the page symbol', () => {
  mock({ data: body() });
  render();
  expect(c.textContent).toContain('Estimates from inferred positions, not exchange data. Not advice.');
  expect(c.textContent).toContain('Critical within 1%');
  expect(c.textContent).toContain('2 coins'); // BTC long and ETH short are within 1%
  expect(c.textContent).toContain('Live');
  expect(bubbles()).toHaveLength(4);
  expect(c.textContent).toContain('BTC detail');
});

test('toggles hide sides and critical-only keeps +-1% levels', () => {
  mock({ data: body() });
  render();
  act(() => btn('Long pain').click());
  expect(bubbles()).toHaveLength(2);
  act(() => btn('Long pain').click());
  act(() => btn('Critical only (within 1%)').click());
  expect(bubbles()).toHaveLength(2);
});

test('clicking a bubble or a table name selects the coin', () => {
  mock({ data: body() });
  render();
  act(() => bubbles()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const eth = [...c.querySelectorAll('table')[0].querySelectorAll('tbody button')].find((b) => b.textContent === 'ETH');
  act(() => eth.click());
  expect(c.textContent).toContain('ETH detail');
});

test('table sorts by a column and flips direction', () => {
  mock({ data: body() });
  render();
  const names = () => [...c.querySelector('table').querySelectorAll('tbody th button')].map((b) => b.textContent);
  expect(names()).toEqual(['ETH', 'BTC']); // est. $ desc by default (950 vs 600)
  act(() => btn('Coin').click());
  expect(names()).toEqual(['ETH', 'BTC']); // first click on a text column is desc
  act(() => btn('Coin ▼').click());
  expect(names()).toEqual(['BTC', 'ETH']);
});

test('search filters the table and the bubbles', () => {
  mock({ data: body() });
  render();
  const input = c.querySelector('input[type="search"]');
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'eth'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(bubbles()).toHaveLength(2);
  expect(c.querySelectorAll('table')[0].querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(1);
});

test('states: loading, error, partial, stale', () => {
  mock({ loading: true });
  render();
  expect(c.textContent).toContain('Loading');
  mock({ error: new Error('x') });
  render();
  expect(c.textContent).toContain('Error');
  expect(c.textContent).toContain('unavailable');
  mock({ data: body({ skipped: 3, count: 17 }) });
  render();
  expect(c.textContent).toContain('3 coins were skipped');
  expect(c.textContent).toContain('Partial');
  mock({ data: body({ stale: true }) });
  render();
  expect(c.textContent).toContain('Stale');
});

test('detail shows touch estimate wording and confluence', () => {
  mock({ data: body() });
  render();
  expect(c.textContent).toContain('Volatility-based estimate, not a forecast');
  expect(c.textContent).toContain('Confluence: 4 of 4 windows within 1%');
  expect(c.textContent).toContain('Short pain above');
  expect(c.textContent).toContain('Long pain below');
});
