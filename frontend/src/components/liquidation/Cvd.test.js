import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import usePolling from '../../lib/usePolling';
import Cvd from './Cvd';

global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./CvdChart', () => ({ __esModule: true, default: (p) => <div data-testid="chart" data-lines={p.lines.map((l) => l.id).join()} data-panes={Object.keys(p.panes).filter((k) => p.panes[k]).join()} data-markers={p.markers.length} /> }));

// 22 candles: flat price with a new high on the last candle while cvd falls = one bearish divergence
const mk = (n, deltaOf, close = (i) => 100 + (i === n - 1 ? 5 : 0)) => { let c = 0; return Array.from({ length: n }, (_, i) => { const d = deltaOf(i); c += d; return { time: 60 * (i + 1), open: 100, high: close(i), low: 99, close: close(i), volume: 20, buy: 10 + d / 2, sell: 10 - d / 2, delta: d, cvd: c }; }); };
const fut = mk(22, (i) => (i === 21 ? -4 : 2));
const spot = mk(22, () => -1);
const trades = (items) => ({ symbol: 'BTCUSDT', available: true, source: 'binance-futures', generatedAt: 1, flow60: { buyUsd: 300000, sellUsd: 100000, netUsd: 200000, trades: 9, coveredMs: 60000 }, items });
const T = [{ id: 1, ts: 1000, side: 'buy', price: 100, usd: 60000 }, { id: 2, ts: 2000, side: 'sell', price: 101, usd: 2000000 }];

let polled;
const setup = ({ cvd = { symbol: 'BTCUSDT', available: true, interval: '15m', generatedAt: 1, candles: fut, spot: { available: true, candles: spot } }, err = null, tr = trades(T) } = {}) => {
  polled = [];
  usePolling.mockImplementation((url) => {
    polled.push(url);
    if (!url) return { data: null, error: null, loading: false };
    return url.includes('/trades') ? { data: tr, error: null, loading: false } : { data: cvd, error: err, loading: !cvd && !err };
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<Cvd symbol="BTCUSDT" />));
  return { el, root };
};
const click = (el, text, sel = 'button') => act(() => { [...el.querySelectorAll(sel)].find((b) => b.textContent.trim() === text).click(); });
beforeEach(() => localStorage.clear());
afterEach(() => { document.body.innerHTML = ''; });

test('header: symbol pill, 7 interval chips (refetch with the chosen one), Live status, FAQ', () => {
  const { el } = setup();
  expect(el.textContent).toContain('BTC');
  expect(el.querySelector('[data-testid="cvd-status"]').textContent).toBe('Live');
  const chips = [...el.querySelectorAll('[aria-label="CVD interval"] button')].map((b) => b.textContent);
  expect(chips).toEqual(['1m', '5m', '15m', '30m', '1h', '4h', '1D']);
  expect(polled.some((u) => u.endsWith('/cvd/BTCUSDT?interval=15m'))).toBe(true);
  click(el, '1h');
  expect(polled.some((u) => u.endsWith('/cvd/BTCUSDT?interval=1h'))).toBe(true);
  expect(el.querySelector('[aria-label="CVD interval"] [aria-pressed="true"]').textContent).toBe('1h');
  expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'FAQ')).toBe(true);
});

test('six stat cards: values from the candles', () => {
  const { el } = setup();
  const cards = [...el.querySelectorAll('[data-testid="cvd-cards"] > div')].map((c) => c.textContent);
  expect(cards).toHaveLength(6);
  expect(cards[0]).toContain('105'); // last close
  expect(cards[1]).toContain('+38 BTC'); // 21*2 - 4
  expect(cards[2]).toContain('-22 BTC');
  expect(cards[3]).toContain('%');
  expect(cards[4]).toContain('futures buying, spot selling');
  expect(cards[5]).toContain('Bearish');
});

test('controls toggle: show, scale, panes, markers; reset view is a button', () => {
  const { el } = setup();
  const chart = () => el.querySelector('[data-testid="chart"]');
  expect(chart().dataset.lines).toBe('fut,spot'); // futures vs spot by default
  click(el, 'Futures');
  expect(chart().dataset.lines).toBe('fut');
  click(el, 'Combined');
  expect(chart().dataset.lines).toBe('combined');
  expect(chart().dataset.panes).toBe('delta');
  click(el, 'Volume');
  click(el, 'Delta bars');
  expect(chart().dataset.panes).toBe('volume');
  expect(chart().dataset.markers).toBe('1');
  click(el, 'Divergence');
  expect(chart().dataset.markers).toBe('0');
  click(el, 'Absolute');
  expect(el.querySelector('[aria-pressed="true"][type="button"]') && [...el.querySelectorAll('[aria-pressed="true"]')].map((b) => b.textContent)).toContain('Absolute');
  expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Reset view')).toBe(true);
});

test('side panel tabs: live trades with flow bar and threshold filter; divergences list', () => {
  const { el } = setup();
  expect(el.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Live trades');
  expect(el.querySelector('[data-testid="flow60"]').textContent).toContain('Net +$200K');
  let rows = el.querySelectorAll('[role="tabpanel"] tbody tr');
  expect(rows).toHaveLength(1); // default threshold 100K hides the 60K trade
  expect(rows[0].textContent).toContain('Sell');
  click(el, '>=50K');
  expect(polled.some((u) => u.endsWith('/trades?min=50000'))).toBe(true);
  rows = el.querySelectorAll('[role="tabpanel"] tbody tr');
  expect(rows).toHaveLength(2);
  click(el, 'Divergences', '[role="tab"]');
  expect(el.querySelector('[role="tab"][aria-selected="true"]').textContent).toBe('Divergences');
  const d = el.querySelectorAll('[role="tabpanel"] tbody tr');
  expect(d).toHaveLength(1);
  expect(d[0].textContent).toContain('Bearish');
});

test('states: loading, stale, futures unavailable but spot ok, nothing available, trades unavailable', () => {
  let { el } = setup({ cvd: null });
  expect(el.querySelector('[data-testid="cvd-status"]').textContent).toBe('Loading');
  ({ el } = setup({ err: new Error('x') }));
  expect(el.querySelector('[data-testid="cvd-status"]').textContent).toBe('Stale');
  ({ el } = setup({ cvd: { symbol: 'BTCUSDT', available: false, reason: 'r', spot: { available: true, candles: spot } } }));
  expect(el.querySelector('[data-testid="cvd-cards"]').textContent).toContain('unavailable from this source');
  expect(el.querySelector('[data-testid="chart"]').dataset.lines).toBe('spot');
  ({ el } = setup({ cvd: { symbol: 'BTCUSDT', available: false, reason: 'r', spot: { available: false, reason: 's' } } }));
  expect(el.textContent).toContain('unavailable from this source: r');
  ({ el } = setup({ tr: { symbol: 'BTCUSDT', available: false, reason: 'nope' } }));
  expect(el.textContent).toContain('Recent trades are unavailable from this source: nope');
});
