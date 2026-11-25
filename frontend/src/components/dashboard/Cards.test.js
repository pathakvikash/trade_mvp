import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { NewsCard, RealMarketsCard, DerivativesPulseCard, LiquidationsSampledCard, MarketClock, QuickActions, CardBoundary } from './Cards';

jest.mock('react-router-dom', () => {
  const h = require('react').createElement;
  return { Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children) };
}, { virtual: true });
jest.mock('../news/NewsFeed', () => ({ __esModule: true, default: (p) => require('react').createElement('div', null, `news ${p.compact} ${p.limit} ${p.category}`) }));
jest.mock('../ai/AgentLauncher', () => ({ __esModule: true, default: ({ label }) => require('react').createElement('button', null, label) }));

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const show = (el) => act(async () => { root.render(el); });

const quotes = { data: { rows: [
  { symbol: 'NIFTY50', name: 'NIFTY 50', category: 'index', price: 24500.5, changePct: 0.4, marketOpen: true, asOf: Date.UTC(2026, 10, 26, 6, 0) },
  { symbol: 'USDINR', name: 'USD/INR', category: 'currency', currency: 'INR', price: 84.1234, changePct: -0.1, marketOpen: null, asOf: Date.UTC(2026, 10, 26, 6, 0) },
  { symbol: 'GOLD', name: 'Gold', category: 'commodity', currency: 'USD', price: 2650, changePct: 1, marketOpen: false, stale: true, asOf: Date.UTC(2026, 10, 26, 5, 0) },
] }, loading: false, error: null };

test('news card passes the contract props and survives a throwing feed', async () => {
  await show(<NewsCard />);
  expect(container.textContent).toContain('Market news');
  expect(container.textContent).toContain('news true 6 all');
  const Boom = () => { throw new Error('x'); };
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await show(<CardBoundary><Boom /></CardBoundary>);
  spy.mockRestore();
  expect(container.textContent).toContain('could not be shown');
});

test('real markets: formatting, status, honesty note, links; error and loading', async () => {
  await show(<RealMarketsCard res={quotes} />);
  const t = container.textContent;
  expect(t).toContain('24,500.5');
  expect(t).toContain('84.12');
  expect(t).toContain('$2,650');
  expect(t).toMatch(/Open/);
  expect(t).toMatch(/Closed/);
  expect(t).toMatch(/n\/a/);
  expect(t).toContain('Delayed, unofficial');
  expect(container.querySelector('a[href="/stocks"]')).toBeTruthy();
  expect(container.querySelector('a[href="/derivatives?category=index&instrument=NIFTY50"]')).toBeTruthy();
  await show(<RealMarketsCard res={{ data: null, loading: false, error: new Error('x') }} />);
  expect(container.textContent).toContain('unavailable');
  await show(<RealMarketsCard res={{ data: null, loading: true, error: null }} />);
  expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
});

const rows = [
  { symbol: 'AAAUSDT', quoteVolume: 300, priceChangePercent: 2, fundingRate: 0.001, openInterestUsd: 2e9 },
  { symbol: 'BBBUSDT', quoteVolume: 100, priceChangePercent: -3, fundingRate: -0.0005, openInterestUsd: null },
];

test('derivatives pulse: values, exclusion note, error state', async () => {
  await show(<DerivativesPulseCard rows={rows} loading={false} failed={false} />);
  const t = container.textContent;
  expect(t).toContain('top 2 perps');
  expect(t).toContain('$2B');
  expect(t).toContain('1 without OI data, excluded');
  expect(t).toContain('+0.0625%');
  expect(t).toContain('1 above +0.03%');
  expect(t).toContain('top 40 perps by volume');
  expect(container.querySelector('a[href="/trade?symbol=AAA"]')).toBeTruthy();
  await show(<DerivativesPulseCard rows={[]} loading={false} failed />);
  expect(container.textContent).toContain('unavailable');
});

test('sampled liquidations: windows, largest events, note, error', async () => {
  const data = { windows: { '1h': { longUsd: 3e6, shortUsd: 1e6 }, '24h': { longUsd: 9e6, shortUsd: 3e6 } }, recent: [{ symbol: 'BTCUSDT', side: 'long', usd: 5e5, ts: Date.now(), price: 1, qty: 1 }] };
  await show(<LiquidationsSampledCard data={data} loading={false} failed={false} />);
  expect(container.textContent).toContain('$4M');
  expect(container.textContent).toContain('$12M');
  expect(container.textContent).toContain('real totals are higher');
  expect(container.querySelector('a[href="/liquidation"]')).toBeTruthy();
  await show(<LiquidationsSampledCard data={null} loading={false} failed />);
  expect(container.textContent).toContain('unavailable');
});

test('market clock: UTC, IST, funding countdown, NSE state', async () => {
  jest.useFakeTimers().setSystemTime(Date.UTC(2026, 10, 26, 7, 30, 0));
  await show(<MarketClock quotes={quotes} />);
  const t = container.textContent;
  expect(t).toContain('07:30:00');
  expect(t).toContain('13:00:00');
  expect(t).toContain('00:30:00');
  expect(t).toContain('Open');
  await show(<MarketClock quotes={{ data: null }} />);
  expect(container.textContent).toContain('n/a');
  jest.useRealTimers();
});

test('quick actions are real links plus Ask AI', async () => {
  await show(<QuickActions />);
  ['/trade?symbol=BTC', '/trade?alerts=1', '/docs'].forEach((h) => expect(container.querySelector(`a[href="${h}"]`)).toBeTruthy());
  expect(container.textContent).toContain('Ask AI');
});
