import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import OrderBookHeatmap from './OrderBookHeatmap';
import LargeOrders from './LargeOrders';
import { collectingText, eventCounts, flowNotice, ageText, ladderPos, ladderRange, largeStatus, suggestMin, tradeStats, wallImbalance } from './orderflow';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockState = {};
let mockTrades = { data: null };
const urls = [];
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: (url) => { if (url) urls.push(url); return url && url.includes('/klines/') ? { data: null } : url && url.includes('/cvd/') ? mockTrades : mockState; } }));

const NOW = Date.now();
const large = (over = {}) => ({
  symbol: 'BTCUSDT', status: 'ok', source: 'binance-futures', collectedMs: 3 * 60e3, tradesSeen: 80, generatedAt: NOW, price: 100,
  thresholds: { wallMult: 10, tradeMult: 10, medianLevelUsd: 1000, medianTradeUsd: 200, tradesNeeded: 50 },
  items: [],
  levels: [
    { side: 'bid', price: 99.5, usd: 49750, mult: 49.7, distPct: -0.5 },
    { side: 'ask', price: 100.4, usd: 7000, mult: 7, distPct: 0.4 },
    { side: 'ask', price: 100.6, usd: 12000, mult: 12, distPct: 0.6 },
  ],
  activeWalls: [{ side: 'bid', price: 99.5, usd: 49750, upForMs: 125e3, distPct: -0.5 }],
  wallEvents: [{ t: NOW - 60e3, side: 'ask', price: 100.6, usd: 12000, lifetimeMs: 40e3, outcome: 'pulled' }, { t: NOW - 90e3, side: 'bid', price: 99.1, usd: 9000, lifetimeMs: 50e3, outcome: 'filled' }, { t: NOW - 120e3, side: 'bid', price: 99.5, usd: 49750, lifetimeMs: 0, outcome: 'appeared' }],
  ...over,
});
const tradesPayload = (over = {}) => ({
  symbol: 'BTCUSDT', available: true, source: 'binance-futures', generatedAt: NOW, min: 100000, count: 1000, windowMs: 40e3, medianUsd: 2000,
  flow60: { buyUsd: 300000, sellUsd: 100000, netUsd: 200000, trades: 90, coveredMs: 40e3 },
  perMin: Array.from({ length: 15 }, (_, i) => ({ t: NOW - (15 - i) * 60e3, buyUsd: i === 14 ? 300000 : 0, sellUsd: i === 14 ? 150000 : 0, n: i === 14 ? 3 : 0 })),
  items: [
    { id: 30, ts: NOW - 5e3, price: 100.1, qty: 3000, usd: 300300, side: 'buy' },
    { id: 29, ts: NOW - 8e3, price: 100, qty: 1500, usd: 150000, side: 'sell' },
  ], ...over,
});

const stub = new Proxy({}, { get: () => () => {}, set: () => true });
let container;
let root;
beforeEach(() => {
  localStorage.clear();
  HTMLCanvasElement.prototype.getContext = () => stub;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const show = (el) => act(() => root.render(el));

test('collectingText and flowNotice', () => {
  expect(collectingText(0)).toBe('Collecting data, less than a minute so far');
  expect(collectingText(7 * 60e3 + 1)).toBe('Collecting data, 7 min so far');
  expect(flowNotice({ response: { status: 404, data: { error: 'no_futures' } } })).toMatch(/no futures market/);
  expect(flowNotice({ response: { status: 404, data: { error: 'no_futures' } } })).not.toMatch(/only for/);
  expect(flowNotice({ response: { status: 503, data: { error: 'collector_busy' } } })).toBe('Order flow is busy with other coins, try again in a minute.');
  expect(flowNotice({ response: { status: 503 } }, null)).toMatch(/unavailable/);
  expect(flowNotice(null, { cols: 1 })).toBeNull();
});

describe('LargeOrders', () => {
  const setup = (f = large(), t = tradesPayload()) => { mockState = { data: f, error: null, loading: false }; mockTrades = { data: t, error: null, loading: false }; show(<LargeOrders symbol="BTCUSDT" />); };
  const click = (el) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  const btn = (txt) => [...container.querySelectorAll('button')].find((b) => b.textContent === txt);
  beforeEach(() => { urls.length = 0; });

  test('header, six stat cards, trades tab with side, price, USD, multiple of median, honest copy', () => {
    setup();
    expect(container.querySelector('#large-orders')).not.toBeNull();
    expect(container.querySelector('[data-testid=status-pill]').textContent).toBe('Live');
    expect(container.textContent).toContain('BTCUSDT');
    expect(container.querySelectorAll('[data-testid=stat-cards] > div')).toHaveLength(6);
    const cards = container.querySelector('[data-testid=stat-cards]').textContent;
    expect(cards).toContain('up 2m 5s'); // largest wall age
    expect(cards).toContain('covers 40 of 60 s'); // covered seconds, not 60
    expect(cards).toContain('2.00x'); // 300.3K vs 150K
    expect(cards).toContain('1 / 1'); // pulled / filled
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Taker buy'); // newest first
    expect(rows[0].textContent).toContain('150x'); // 300.3K / 2K
    expect(container.querySelector('[role=region][aria-label^="Large trades"]')).not.toBeNull();
    expect(container.textContent).toContain('not advice');
    expect(container.textContent).toContain('can be pulled');
    expect(container.textContent).toContain('Collecting data, 3 min so far');
    expect(container.querySelector('[data-testid=whale-prints] svg')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid=whale-prints] rect').length).toBeGreaterThan(0);
  });

  test('threshold chip drives the trades request; default is 100K', () => {
    setup();
    expect(urls.some((u) => u.endsWith('/cvd/BTCUSDT/trades?min=100000'))).toBe(true);
    expect(btn('>=100K').getAttribute('aria-pressed')).toBe('true');
    click(btn('>=1M'));
    expect(urls[urls.length - 1]).toMatch(/\/cvd\/BTCUSDT\/trades\?min=1000000$/);
    click(btn('>=10K'));
    expect(urls[urls.length - 1]).toMatch(/trades\?min=10000$/);
  });

  test('thin coin with no large trades: says so and suggests a lower chip from the median trade', () => {
    setup(large(), tradesPayload({ items: [], medianUsd: 400, windowMs: 6 * 60e3, count: 1000 }));
    expect(container.textContent).toContain('No trades above $100K in the last 6 min, try a lower threshold');
    const s = btn('Try >=10K (median trade here is $400)');
    expect(s).toBeTruthy();
    click(s);
    expect(urls[urls.length - 1]).toMatch(/trades\?min=10000$/);
  });

  test('walls tab filters by the x-median chip; events tab lists the log; row click puts its price on the ladder', () => {
    setup();
    click(container.querySelector('#lo-tab-walls'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2); // 10x: the 7x level is hidden
    expect(container.querySelector('tbody').textContent).not.toContain('100.4');
    click(btn('5x'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    click(btn('20x'));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody').textContent).toContain('2m 5s'); // up for
    expect(container.querySelector('[data-testid=ladder-sel]')).toBeNull();
    click(container.querySelector('tbody button'));
    expect(container.querySelector('[data-testid=ladder-sel]')).not.toBeNull();
    expect(container.querySelector('[data-testid=price-ladder]').textContent).toContain('Selected 99.5: -0.50% from price');
    click(container.querySelector('#lo-tab-events'));
    const ev = [...container.querySelectorAll('tbody tr')];
    expect(ev.map((r) => r.children[0].textContent.split('after')[0])).toEqual(['Pulled', 'Filled', 'Appeared']);
  });

  test('new rows keep existing row elements (stable keys), so polling does not reset the scroll', () => {
    setup();
    const first = container.querySelectorAll('tbody tr')[0];
    const t = tradesPayload();
    setup(large(), { ...t, items: [{ id: 31, ts: NOW - 1e3, price: 100.2, qty: 1500, usd: 150300, side: 'sell' }, ...t.items] });
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe(first);
  });

  test('collecting, thin, stale, busy and no-futures states', () => {
    mockTrades = { data: tradesPayload(), error: null, loading: false };
    mockState = { data: large({ status: 'collecting', collectedMs: 0, items: [] }), error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.querySelector('[data-testid=status-pill]').textContent).toBe('Collecting');
    click(container.querySelector('#lo-tab-walls'));
    expect(container.textContent).toContain('Collecting data, less than a minute so far.');
    mockState = { data: large({ status: 'thin' }), error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.querySelector('[data-testid=status-pill]').textContent).toBe('Thin');
    expect(container.textContent).toContain('Thin book');
    click(container.querySelector('#lo-tab-trades')); // trades still work on a thin book
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    mockState = { data: large({ stale: true, status: 'stale' }), error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.querySelector('[data-testid=status-pill]').textContent).toBe('Stale');
    expect(container.textContent).toContain('refresh failed');
    mockState = { data: null, error: { response: { status: 503, data: { error: 'collector_busy' } } }, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.querySelector('[data-testid=status-pill]').textContent).toBe('Busy');
    mockState = { data: null, error: { response: { status: 404, data: {} } }, loading: false };
    mockTrades = { data: null, error: { response: { status: 404, data: {} } }, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.textContent).toContain('no futures market');
  });
});

describe('Large Orders helpers', () => {
  test('tradeStats: largest, counts, USD ratio', () => {
    const s = tradeStats([{ side: 'buy', usd: 100 }, { side: 'buy', usd: 300 }, { side: 'sell', usd: 100 }]);
    expect(s).toMatchObject({ buyN: 2, sellN: 1, buyUsd: 400, sellUsd: 100, buyShare: 80 });
    expect(s.largest.usd).toBe(300);
    expect(tradeStats([]).buyShare).toBeNull();
  });
  test('wallImbalance only counts walls within 2%', () => {
    const r = wallImbalance([{ side: 'bid', usd: 300, distPct: -1 }, { side: 'ask', usd: 100, distPct: 1.5 }, { side: 'ask', usd: 9999, distPct: 3 }]);
    expect(r).toMatchObject({ bidUsd: 300, askUsd: 100, imbalance: 50 });
    expect(wallImbalance([]).imbalance).toBeNull();
  });
  test('eventCounts, suggestMin, ageText, ladder', () => {
    expect(eventCounts([{ outcome: 'pulled' }, { outcome: 'pulled' }, { outcome: 'filled' }, { outcome: 'appeared' }])).toEqual({ pulled: 2, filled: 1 });
    const chips = [10e3, 50e3, 100e3, 500e3, 1e6];
    expect(suggestMin(200, 100e3, chips)).toBe(10e3);
    expect(suggestMin(5000, 100e3, chips)).toBe(50e3);
    expect(suggestMin(5000, 10e3, chips)).toBeNull();
    expect(ageText(59e3)).toBe('59s');
    expect(ageText(125e3)).toBe('2m 5s');
    expect(ladderPos(101, 100, 2)).toMatchObject({ pct: 75, off: false });
    expect(ladderPos(110, 100, 2)).toMatchObject({ pct: 100, off: true });
    expect(ladderRange([0.3, -0.7])).toBe(1);
  });
  test('largeStatus', () => {
    expect(largeStatus({ status: 'ok' }, null, { available: true })[0]).toBe('Live');
    expect(largeStatus({ status: 'ok' }, null, { available: false })[0]).toBe('Stale');
    expect(largeStatus(null, null, null)[0]).toBe('Loading');
  });
});

test('thin book, busy and no-futures states in both panels', () => {
  mockTrades = { data: null, error: { response: { status: 404, data: {} } }, loading: false };
  [OrderBookHeatmap, LargeOrders].forEach((C) => {
    mockState = { data: { symbol: 'MANTRAUSDT', status: 'thin', collectedMs: 0, items: [] }, error: null, loading: false };
    show(<C symbol="MANTRAUSDT" />);
    if (C === LargeOrders) act(() => { container.querySelector('#lo-tab-walls').click(); }); // the Trades tab still works on a thin book
    expect(container.textContent).toContain('Thin book');
    expect(container.querySelector('canvas')).toBeNull();
    mockState = { data: null, error: { response: { status: 503, data: { error: 'collector_busy' } } }, loading: false };
    show(<C symbol="MANTRAUSDT" />);
    expect(container.textContent).toContain('busy with other coins, try again in a minute');
    mockState = { data: null, error: { response: { status: 404, data: { error: 'no_futures' } } }, loading: false };
    show(<C symbol="MANTRAUSDT" />);
    expect(container.textContent).toContain('no futures market');
    mockState = { data: { symbol: 'MANTRAUSDT', status: 'collecting', collectedMs: 3 * 60e3, items: [] }, error: null, loading: false };
    show(<C symbol="MANTRAUSDT" />);
    expect(container.textContent).toContain('Collecting data, 3 min so far');
  });
});
