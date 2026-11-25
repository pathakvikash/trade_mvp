import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Market from './Market';
import usePolling from '../lib/usePolling';

// react-router-dom@7 has no dist/main.js in this install and Jest 27 (CRA) ignores "exports", so it cannot be
// loaded under Jest. The page only needs Link and useSearchParams, so the test provides them.
let mockQuery = '';
jest.mock('react-router-dom', () => {
  const React = require('react');
  return {
    __esModule: true,
    Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children),
    useSearchParams: () => [new URLSearchParams(mockQuery), jest.fn()],
  };
}, { virtual: true });

jest.mock('lightweight-charts', () => ({ createChart: jest.fn() }));
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../store/futuresStore', () => {
  const state = {
    symbol: null, candles: [], mark: null, interval: '1m', error: null, reloadSeq: 0,
    subscribe: () => {}, unsubscribe: () => {}, setTimeframe: () => {},
  };
  return { __esModule: true, default: (selector) => selector(state) };
});

const row = (symbol, lastPrice, quoteVolume) => ({
  symbol, lastPrice, markPrice: lastPrice, indexPrice: lastPrice, high: lastPrice, low: lastPrice,
  priceChangePercent: 1.25, quoteVolume, fundingRate: 0.0001, fundingIntervalHours: 8, openInterestUsd: 1e9, nextFundingTime: 0,
});
const ROWS = [row('BTCUSDT', 60000, 5e9), row('ETHUSDT', 3000, 2e9), row('SOLUSDT', 150, 1e9)];

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(() => {
  localStorage.clear();
  usePolling.mockReturnValue({ data: ROWS, error: null, loading: false });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

const renderAt = async (query = '') => {
  mockQuery = query;
  await act(async () => { root.render(<Market />); });
};

const listedMarkets = () => Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('td').textContent);
const selectedRow = () => container.querySelector('tr[aria-current="true"]');

const typeSearch = async (value) => {
  const input = container.querySelector('input[aria-label="Search markets"]');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

test('lists markets by volume and selects BTCUSDT by default', async () => {
  await renderAt();
  expect(listedMarkets()).toEqual(['BTC', 'ETH', 'SOL']);
  expect(selectedRow().textContent).toContain('BTC');
});

test('honours ?symbol= in the URL', async () => {
  await renderAt('symbol=SOLUSDT');
  expect(selectedRow().textContent).toContain('SOL');
});

test('search filters the list and shows No matches when nothing fits', async () => {
  await renderAt();
  await typeSearch('eth');
  expect(listedMarkets()).toEqual(['ETH']);

  await typeSearch('zzz');
  expect(listedMarkets()).toEqual([]);
  expect(container.textContent).toContain('No matches');

  await typeSearch('');
  expect(listedMarkets()).toHaveLength(3);
});

test('remembers the selected market across remounts, URL wins, stale value ignored', async () => {
  await renderAt();
  await act(async () => { container.querySelectorAll('tbody tr')[2].click(); });
  act(() => root.unmount());
  root = createRoot(container);
  await renderAt();
  expect(selectedRow().textContent).toContain('SOL');

  act(() => root.unmount());
  root = createRoot(container);
  await renderAt('symbol=ETHUSDT');
  expect(selectedRow().textContent).toContain('ETH');

  localStorage.setItem('tm:v1:anon:market.symbol', '"bad"');
  act(() => root.unmount());
  root = createRoot(container);
  await renderAt();
  expect(selectedRow().textContent).toContain('BTC');
});

test('remembers the list search', async () => {
  await renderAt();
  await typeSearch('eth');
  act(() => root.unmount());
  root = createRoot(container);
  await renderAt();
  expect(listedMarkets()).toEqual(['ETH']);
});

test('responsive list: core columns always, Volume from sm, Funding only sm..lg, no sideways scroll, bounded height', async () => {
  await act(async () => { root.render(<Market />); });
  const th = (n) => [...container.querySelectorAll('th')].find((t) => t.textContent.includes(n));
  expect(th('Market').className).not.toMatch(/hidden/);
  expect(th('Last').className).not.toMatch(/hidden/);
  expect(th('24h').className).not.toMatch(/hidden/);
  expect(th('Volume').className).toContain('max-sm:hidden');
  expect(th('Funding').className).toContain('max-md:hidden');
  expect(th('Funding').className).toContain('lg:hidden');
  const table = container.querySelector('table');
  expect(table.className).not.toMatch(/min-w-\[/);
  const scroller = table.parentElement;
  expect(scroller.className).toContain('overflow-x-hidden');
  expect(scroller.className).toContain('max-lg:max-h-[min(40rem,calc(100dvh-12rem))]');
  const list = scroller.closest('section');
  expect(list.className).toContain('lg:sticky');
  expect(list.className).toContain('xl:h-auto');
  expect(container.querySelector('.grid-cols-1')).not.toBeNull();
});
