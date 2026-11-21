import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import CoinDetail from './CoinDrawer';
import { summarizeCoin, insightText } from './coinStats';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ __esModule: true, useNavigate: () => mockNavigate }), { virtual: true });

const NOW = Date.now();
const H = 3600e3;
let mockLiq;
const mockOverview = [{ symbol: 'ETHUSDT', lastPrice: 3000, priceChangePercent: -2.5, fundingRate: 0.0001, fundingIntervalHours: 8, openInterestUsd: 5e9, quoteVolume: 1e10 }];
jest.mock('../../lib/usePolling', () => ({
  __esModule: true,
  default: (url) => (url.includes('/overview') ? { data: mockOverview, error: null } : mockLiq),
}));

const events = [
  { side: 'long', price: 2990, usd: 150000, ts: NOW - 2 * H },
  { side: 'long', price: 3010, usd: 50000, ts: NOW - 1 * H },
  { side: 'short', price: 3050, usd: 50000, ts: NOW - 30 * H }, // older than 24h: ignored
  { side: 'short', price: 3020, usd: 25000, ts: NOW - 0.5 * H },
];
const bySymbol = [
  { symbol: 'BTCUSDT', longUsd: 900000, shortUsd: 100000, count: 9 },
  { symbol: 'ETHUSDT', longUsd: 200000, shortUsd: 25000, count: 3 },
];

let container;
let root;
let onClose;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear();
  mockNavigate.mockClear();
  mockLiq = { data: { since: NOW - 48 * H, events }, error: null };
  onClose = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = () => act(() => root.render(<CoinDetail symbol="ETHUSDT" bySymbol={bySymbol} onClose={onClose} />));
const text = () => container.textContent;

test('summarizeCoin: 24h window, split, largest, hourly buckets', () => {
  const s = summarizeCoin(events, NOW - 48 * H, NOW);
  expect(s.count).toBe(3);
  expect(s.total).toBe(225000);
  expect(s.longPct).toBeCloseTo(88.9, 1);
  expect(s.largest.usd).toBe(150000);
  expect(s.hours).toHaveLength(24);
  expect(s.hours.reduce((a, h) => a + h.long + h.short, 0)).toBe(225000);
  expect(s.windowMs).toBe(24 * H);
  expect(summarizeCoin(events, NOW - 2 * H, NOW).windowMs).toBe(2 * H);
  const msg = insightText(s, { coin: 'ETH', changePct: -2.5, fmtPrice: String, fmtUsd: String });
  expect(msg).toMatch(/^Longs dominate \(89%\)/);
  expect(msg).toContain('down 2.50%');
});

test('renders numbers from fixture data', () => {
  render();
  expect(container.querySelector('[role="dialog"]').getAttribute('aria-modal')).toBe('true');
  expect(container.querySelector('[data-testid="total"]').textContent).toBe('$225K');
  expect(text()).toContain('Longs $200K (89%)');
  expect(text()).toContain('Dominant side: longs');
  expect(text()).toContain('#2 of 2');
  expect(text()).toContain('3,000.00');
  expect(text()).toContain('-2.50%');
  expect(text()).toContain('0.0100% / 8h');
  expect(text()).toContain('$5B');
  expect(container.querySelector('[data-testid="insight"]').textContent).toMatch(/Longs dominate/);
  expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  expect(container.querySelectorAll('tbody tr.bg-amber-400\\/10')).toHaveLength(1); // the $150K event
});

test('closes on Escape and on backdrop click', () => {
  render();
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => container.querySelector('[data-testid="backdrop"]').click());
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('empty state when the coin has no sampled events', () => {
  mockLiq = { data: { since: NOW - 48 * H, events: [] }, error: null };
  render();
  expect(text()).toContain('No sampled liquidations for ETH');
  expect(container.querySelector('[data-testid="insight"]')).toBeNull();
});

test('loading shows skeletons, error shows a notice', () => {
  mockLiq = { data: null, error: null };
  act(() => root.render(<CoinDetail symbol="ETHUSDT" bySymbol={null} onClose={onClose} />));
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  mockLiq = { data: null, error: new Error('x') };
  act(() => root.render(<CoinDetail symbol="ETHUSDT" bySymbol={null} onClose={onClose} />));
  expect(text()).toContain('Liquidation data unavailable');
});

test('Open in Trade persists the base symbol under trade.symbol and navigates', () => {
  render();
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Open in Trade');
  act(() => btn.click());
  expect(JSON.parse(localStorage.getItem('tm:v1:anon:trade.symbol'))).toBe('ETH');
  expect(mockNavigate).toHaveBeenCalledWith('/trade');
});
