import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import OrderBookHeatmap from './OrderBookHeatmap';
import { obhFixture } from './obhFixture';

global.IS_REACT_ACT_ENVIRONMENT = true;

let mockState = {};
let mockKlines = { data: null };
const urls = [];
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: (url) => { if (url) urls.push(url); return url && url.includes('/klines/') ? mockKlines : mockState; } }));

const stub = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 30 }) : () => {}), set: () => true });
let container;
let root;
beforeEach(() => {
  localStorage.clear();
  urls.length = 0;
  mockKlines = { data: [{ time: 1e9, open: 1, close: 2, high: 3, low: 0.5, volume: 4 }] };
  HTMLCanvasElement.prototype.getContext = () => stub;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const show = (el = <OrderBookHeatmap symbol="BTCUSDT" />) => act(() => root.render(el));
const ok = (over) => { mockState = { data: obhFixture(over), error: null, loading: false }; show(); };
const click = (el) => act(() => { el.click(); });
const tab = (name) => click([...container.querySelectorAll('[role=tab]')].find((t) => t.textContent === name));

test('honest caption, header, canvas label, explainer and the data summary', () => {
  ok();
  const t = container.textContent;
  expect(t).toContain('Built from depth snapshots since the collector started; not historical');
  expect(t).toContain('spoofing');
  expect(t).toContain('Collecting data, 7 min so far');
  expect(t).toContain('Collecting 7 min'); // the chip
  expect(t).toContain('BTC order book heatmap');
  expect(t).toContain('BTCUSDT Perp');
  expect(t).toContain('Live');
  expect(container.querySelector('canvas').getAttribute('aria-label')).toContain('order book heatmap');
  expect(container.querySelector('#order-book-heatmap')).not.toBeNull();
  expect(t).not.toContain('Bybit');
  expect(container.querySelector('[data-testid=crosshair-readout]').textContent).toContain('Grid 1');
});

test('explainer: worked example, legend and the three cases', () => {
  ok();
  const t = container.querySelector('[aria-labelledby=obh-explain-h]').textContent;
  expect(t).toContain('What is an orderbook heatmap?');
  ['Grey line = price', 'taker buys', 'taker sells', 'Pulled', 'Filled', 'Holds'].forEach((w) => expect(t).toContain(w));
});

test('six stat cards: price, depths, imbalance with delta, walls with distance and age', () => {
  ok();
  const cards = [...container.querySelectorAll('[data-testid^=stat-]')];
  expect(cards).toHaveLength(6);
  expect(cards[3].textContent).toContain('+20.0%');
  expect(cards[3].textContent).toContain('bids heavier');
  expect(cards[3].textContent).toContain('5 min ago -2.7%');
  expect(cards[4].textContent).toContain('-1.16% from price');
  expect(cards[4].textContent).toContain('up 2m');
  expect(cards[5].textContent).toContain('None at 10x');
  ok({ depth: { ...obhFixture().depth, partial: true, bandPct: 0.4 } });
  expect(container.querySelector('[data-testid=stat-bid]').textContent).toContain('within 0.4%');
});

test('side panel tabs: Book ladder with spread row and cumulative, Walls, Wall events; each list sits in a ScrollArea', () => {
  ok();
  expect(container.querySelector('[role=tablist][aria-label="Order book details"]')).not.toBeNull();
  const book = container.querySelector('[role=region][aria-label^="Latest order book"]');
  expect(book).not.toBeNull();
  const rows = [...book.querySelectorAll('tbody tr')].map((r) => r.textContent);
  expect(rows).toHaveLength(5); // 2 asks, spread, 2 bids
  expect(rows[0]).toContain('103'); // far ask first, best ask just above the spread
  expect(rows[1]).toContain('102.5');
  expect(rows[2]).toContain('Spread 1');
  expect(rows[3]).toContain('101.5');
  expect(book.querySelectorAll('thead th')[3].textContent).toBe('Cumulative');
  tab('Walls');
  expect(container.querySelector('[role=region][aria-label^="Current walls"]').textContent).toContain('14.24M');
  tab('Wall events');
  const ev = [...container.querySelectorAll('[role=region][aria-label^="Wall events"] tbody tr')].map((r) => r.textContent);
  expect(ev).toHaveLength(3);
  expect(ev[0]).toContain('Appeared');
  expect(ev[1]).toContain('Pulled');
  expect(ev[2]).toContain('Filled');
  ok({ wallEvents: [], walls: { ...obhFixture().walls, active: [] } });
  tab('Wall events');
  expect(container.textContent).toContain('No wall has appeared, been pulled or been filled');
  tab('Walls');
  expect(container.textContent).toContain('No wall at 10x the median level right now');
});

test('unit toggle switches the colour-range readout and the book cumulative; the choice is remembered', () => {
  ok();
  expect(container.querySelector('[data-testid=range-readout]').textContent).toBe('$0 - $500');
  click([...container.querySelectorAll('[role=tab]')].find((t) => t.textContent === 'Size'));
  expect(container.querySelector('[data-testid=range-readout]').textContent).not.toContain('$');
  expect(JSON.stringify(Object.entries(localStorage))).toContain('obh.unit');
  act(() => root.unmount());
  root = createRoot(container);
  ok();
  expect(container.querySelector('[role=tab][aria-selected=true]').textContent).toBe('Size');
});

test('layers menu toggles and persists; depth band and price grid selects change the request', () => {
  ok();
  click(container.querySelector('button[aria-haspopup][aria-expanded]:not([aria-label])') || [...container.querySelectorAll('button')].find((b) => b.textContent === 'Layers'));
  const boxes = [...document.body.querySelectorAll('[role=group][aria-label=Layers] input')];
  expect(boxes.map((b) => b.checked)).toEqual([true, true, true, true]);
  expect(document.body.textContent).toContain('Trade bubbles');
  act(() => { boxes[3].click(); });
  expect(boxes[3].checked).toBe(false);
  expect(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith('obh.layers')))).toContain('"trades":false');
  const sel = (label) => container.querySelector(`select[aria-label="${label}"]`);
  act(() => { sel('Depth band').value = '2'; sel('Depth band').dispatchEvent(new Event('change', { bubbles: true })); });
  expect(urls.some((u) => u.includes('/heatmap/BTCUSDT?') && u.includes('band=2'))).toBe(true);
  act(() => { sel('Price grid').value = '5'; sel('Price grid').dispatchEvent(new Event('change', { bubbles: true })); });
  expect(urls.some((u) => u.includes('grid=5'))).toBe(true);
  expect(sel('Price grid').textContent).toContain('5'); // base 1 x 5
});

test('candles come from the klines route for the chosen interval, and not when the layer is off', () => {
  ok();
  expect(urls.some((u) => /\/klines\/BTCUSDT\?interval=1m&limit=150$/.test(u))).toBe(true);
  act(() => { const s = container.querySelector('#obh-interval'); s.value = '5m'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(urls.some((u) => u.includes('interval=5m'))).toBe(true);
});

test('states: collecting, thin, stale, fallback source, unavailable, no futures, busy, loading; never fake data', () => {
  const st = (state, symbol = 'BTCUSDT') => { mockState = state; show(<OrderBookHeatmap symbol={symbol} />); };
  st({ data: { symbol: 'BTCUSDT', status: 'collecting', collectedMs: 0 }, error: null, loading: false });
  expect(container.querySelector('canvas')).toBeNull();
  expect(container.querySelector('[role=status]').textContent).toContain('Collecting data, less than a minute so far');
  st({ data: { symbol: 'MANTRAUSDT', status: 'thin', collectedMs: 0 }, error: null, loading: false }, 'MANTRAUSDT');
  expect(container.textContent).toContain('Thin book');
  expect(container.querySelector('canvas')).toBeNull();
  st({ data: obhFixture({ status: 'stale', stale: true }), error: null, loading: false });
  expect(container.textContent).toContain('refresh failed');
  expect(container.textContent).toContain('Stale');
  st({ data: obhFixture({ source: 'bybit' }), error: null, loading: false });
  expect(container.textContent).toContain('Order book from bybit perpetuals');
  st({ data: null, error: { response: { status: 503, data: { error: 'x', degraded: true } } }, loading: false });
  expect(container.textContent).toContain('unavailable from this server');
  st({ data: null, error: { response: { status: 404, data: { error: 'no_futures' } } }, loading: false }, 'PEPEUSDT');
  expect(container.textContent).toContain('no futures market');
  st({ data: null, error: { response: { status: 503, data: { error: 'collector_busy' } } }, loading: false });
  expect(container.textContent).toContain('busy with other coins, try again in a minute');
  st({ data: null, error: null, loading: true });
  expect(container.textContent).toContain('Loading');
  expect(container.querySelector('[aria-labelledby=obh-explain-h]')).not.toBeNull(); // the explainer is there in every state
});

test('touch targets are 44px on small screens, controls have accessible names, maximise toggles', () => {
  ok();
  expect(container.querySelector('select').className).toContain('min-h-[44px]');
  ['Colouring', 'Price grid', 'Depth band', 'Sub panes', 'Download picture (PNG)', 'Refresh now', 'Maximise chart'].forEach((l) => expect(container.querySelector(`[aria-label="${l}"]`)).not.toBeNull());
  expect(container.querySelector('[aria-label="Download picture (PNG)"]').className).toContain('min-h-[44px]');
  click(container.querySelector('[aria-label="Maximise chart"]'));
  expect(container.querySelector('[aria-label="Restore chart"]')).not.toBeNull();
  expect(container.querySelector('#order-book-heatmap').className).toContain('!fixed');
});
