import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import OrderBookHeatmap, { drawBook } from './OrderBookHeatmap';
import LargeOrders from './LargeOrders';
import { collectingText, flowNotice } from './orderflow';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockState = {};
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: () => mockState }));

const grid = (over = {}) => ({
  symbol: 'BTCUSDT', status: 'ok', source: 'binance-futures', collectedMs: 7 * 60e3, samples: 84, sampleMs: 5000, retainMs: 7200e3, generatedAt: 1e12,
  t0: 1e12, colMs: 5000, cols: 3, rows: 4, priceMin: 100, priceStep: 1, price: 102, max: 500, mids: [102, null, 102.5], gaps: [1],
  cells: [0, 100, 500, 0, 0, 0, 0, 0, 200, 0, 0, 50], ...over,
});
const large = (over = {}) => ({
  symbol: 'BTCUSDT', status: 'ok', source: 'binance-futures', collectedMs: 3 * 60e3, tradesSeen: 80, generatedAt: 1e12, price: 100,
  thresholds: { wallMult: 10, tradeMult: 10, medianLevelUsd: 1000, medianTradeUsd: 200, tradesNeeded: 50 },
  items: [
    { kind: 'wall', side: 'bid', price: 99.5, qty: 500, usd: 49750, mult: 49.7, ts: 1e12, distPct: -0.5 },
    { kind: 'trade', side: 'sell', price: 100, qty: 30, usd: 3000, mult: 15, ts: 1e12 + 1000 },
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
  expect(flowNotice(null, grid())).toBeNull();
});

describe('OrderBookHeatmap', () => {
  test('honest caption, source-free state and the data summary', () => {
    mockState = { data: grid(), error: null, loading: false };
    show(<OrderBookHeatmap symbol="BTCUSDT" />);
    const t = container.textContent;
    expect(t).toContain('Built from depth snapshots since the collector started; not historical');
    expect(t).toContain('spoofing');
    expect(t).toContain('Collecting data, 7 min so far');
    expect(container.querySelector('canvas').getAttribute('aria-label')).toContain('order book heatmap');
    expect(container.querySelector('#order-book-heatmap')).not.toBeNull();
    expect(t).not.toContain('Bybit');
  });

  test('collecting, stale, fallback source, unavailable, loading states; never fake data', () => {
    mockState = { data: { symbol: 'BTCUSDT', status: 'collecting', collectedMs: 0 }, error: null, loading: false };
    show(<OrderBookHeatmap symbol="BTCUSDT" />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('[role=status]').textContent).toContain('Collecting data, less than a minute so far');

    mockState = { data: grid({ status: 'stale', stale: true }), error: null, loading: false };
    show(<OrderBookHeatmap symbol="BTCUSDT" />);
    expect(container.textContent).toContain('refresh failed');

    mockState = { data: grid({ source: 'bybit' }), error: null, loading: false };
    show(<OrderBookHeatmap symbol="BTCUSDT" />);
    expect(container.textContent).toContain('Order book from bybit perpetuals');

    mockState = { data: null, error: { response: { status: 503, data: { error: 'x', degraded: true } } }, loading: false };
    show(<OrderBookHeatmap symbol="BTCUSDT" />);
    expect(container.textContent).toContain('unavailable from this server');
    expect(container.querySelector('canvas')).toBeNull();

    mockState = { data: null, error: { response: { status: 404, data: { error: 'no_futures' } } }, loading: false };
    show(<OrderBookHeatmap symbol="PEPEUSDT" />);
    expect(container.textContent).toContain('no futures market');

    mockState = { data: null, error: null, loading: true };
    show(<OrderBookHeatmap symbol="BTCUSDT" />);
    expect(container.textContent).toContain('Loading');
  });

  test('drawBook paints each non-empty cell once, skips gap columns, and draws the mid path', () => {
    const fills = [];
    const ctx = new Proxy({}, { get: (t, k) => (k === 'fillRect' ? (...a) => fills.push(a) : () => {}), set: () => true });
    drawBook(ctx, 400, 300, grid(), 'viridis');
    expect(fills).toHaveLength(4); // 100, 500, 200, 50: the gap column (1) has none
  });

  test('controls are 44px tall', () => {
    mockState = { data: grid(), error: null, loading: false };
    show(<OrderBookHeatmap symbol="BTCUSDT" />);
    expect(container.querySelector('select').className).toContain('min-h-[44px]');
  });
});

describe('LargeOrders', () => {
  test('lists walls and trades with labels, thresholds and a no-advice caption', () => {
    mockState = { data: large(), error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Wall');
    expect(rows[0].textContent).toContain('Bid');
    expect(rows[0].textContent).toContain('50x');
    expect(rows[1].textContent).toContain('Trade');
    expect(rows[1].textContent).toContain('Taker sell');
    expect(container.textContent).toContain('not advice');
    expect(container.textContent).toContain('at least 10x the median level');
    expect(container.querySelector('#large-orders')).not.toBeNull();
  });

  test('collecting, too few trades, empty, stale and error states', () => {
    mockState = { data: { symbol: 'BTCUSDT', status: 'collecting', collectedMs: 0, items: [] }, error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.textContent).toContain('Collecting data, less than a minute so far');

    mockState = { data: large({ tradesSeen: 10 }), error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.textContent).toContain('10 of 50 recent trades seen');

    mockState = { data: large({ items: [] }), error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.textContent).toContain('No level or trade is above the threshold');

    mockState = { data: large({ stale: true, status: 'stale' }), error: null, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.textContent).toContain('refresh failed');

    mockState = { data: null, error: { response: { status: 503, data: {} } }, loading: false };
    show(<LargeOrders symbol="BTCUSDT" />);
    expect(container.textContent).toContain('unavailable from this server');
  });
});

test('thin book, busy and no-futures states in both panels', () => {
  [OrderBookHeatmap, LargeOrders].forEach((C) => {
    mockState = { data: { symbol: 'MANTRAUSDT', status: 'thin', collectedMs: 0, items: [] }, error: null, loading: false };
    show(<C symbol="MANTRAUSDT" />);
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
