import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LiqHeatmap from './LiqHeatmap';

global.IS_REACT_ACT_ENVIRONMENT = true;

const DATA = () => {
  const d = {
    cols: 10, rows: 8, t0: 1700000000000, colMs: 300000, priceMin: 100, priceStep: 10, price: 145, max: 1000, generatedAt: 1700003000000,
    cells: [], candles: [], totals: { longUsd: 500, shortUsd: 600 }, largest: { usd: 1000, side: 'long', price: 135 },
    keyLevels: { above: [{ price: 165, usd: 400, pct: 13.8 }], below: [{ price: 125, usd: 300, pct: -13.8 }] },
  };
  for (let c = 0; c < 10; c += 1) {
    d.candles.push({ open: 140, close: 141 + c, high: 150, low: 130 });
    for (let r = 0; r < 8; r += 1) d.cells.push(c === 3 ? (r + 1) * 10 : 0);
  }
  return d;
};

const stub = new Proxy({}, { get: (t, k) => (k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}), set: () => true });
let container;
let root;
let origGet;
let origRect;
beforeEach(() => {
  localStorage.clear();
  origGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = () => stub;
  HTMLCanvasElement.prototype.toBlob = (cb) => cb(new Blob(['png']));
  global.ResizeObserver = class { observe() {} disconnect() {} };
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
  origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  HTMLCanvasElement.prototype.getContext = origGet;
  Element.prototype.getBoundingClientRect = origRect;
});

const mount = (extra = {}) => act(() => root.render(<LiqHeatmap symbol="BTCUSDT" range="24h" onRange={() => {}} data={DATA()} source={null} loading={false} error={null} onRefresh={jest.fn()} refreshing={false} {...extra} />));
const plot = () => container.querySelector('[aria-label^="Heatmap cell cursor"]');
const btn = (name) => [...container.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);
// jsdom has no PointerEvent: a MouseEvent of the pointer type carries the position, pointerType is added by hand.
const ptr = (type, x, y, pointerType = 'mouse') => act(() => {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, relatedTarget: type === 'pointerout' ? document.body : null });
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  plot().dispatchEvent(e);
});
const mouse = (type, x, y) => {
  if (type === 'mousemove') ptr('pointermove', x, y);
  else if (type === 'mouseleave') ptr('pointerout', x, y);
  else act(() => { plot().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y })); });
};
const tip = () => document.body.querySelector('[role="tooltip"]') || container.querySelector('[role="tooltip"]');

test('toolbar has Updated time, Refresh, layout menu, mode toggle and Screenshot; existing wording stays', () => {
  const onRefresh = jest.fn();
  mount({ onRefresh });
  const t = container.textContent;
  expect(t).toMatch(/Updated \d{1,2}:\d{2}/);
  expect(t).toContain('Estimated model.');
  expect(t).toContain('Single chart');
  expect(btn('Pan')).toBeTruthy();
  expect(btn('Measure')).toBeTruthy();
  expect(btn('Download heatmap screenshot')).toBeTruthy();
  act(() => btn('Refresh heatmap').click());
  expect(onRefresh).toHaveBeenCalled();
  expect(container.querySelector('[role="group"][aria-label="Heatmap controls"]')).not.toBeNull();
});

test('hovering a cell shows the card, leaving hides it', () => {
  mount();
  mouse('mousemove', 95, 100); // column 3, row 3
  const text = tip().textContent;
  expect(text).toContain('5 min per column');
  expect(text).toContain('Swept from the close to here');
  expect(text).toContain('Close 144'); // candle 3 closes at 144
  mouse('mouseleave', 95, 100);
  expect(tip()).toBeNull();
});

test('keyboard: arrows move the cursor, Escape closes it', () => {
  mount();
  const key = (k) => act(() => { plot().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
  key('ArrowLeft');
  expect(tip()).not.toBeNull();
  expect(plot().getAttribute('aria-describedby')).toBe(tip().id);
  key('Escape');
  expect(tip()).toBeNull();
});

test('a tap shows the card with a close button that stays until closed', () => {
  mount();
  ptr('pointerdown', 95, 100, 'touch');
  mouse('click', 95, 100);
  expect(tip()).not.toBeNull();
  mouse('mouseleave', 0, 0);
  expect(tip()).not.toBeNull();
  act(() => tip().querySelector('button[aria-label="Close cell details"]').click());
  expect(tip()).toBeNull();
});

test('measure mode: two clicks give price delta, time delta and the swept estimate; Pan leaves no marks', () => {
  mount();
  act(() => btn('Measure').click());
  expect(container.textContent).toContain('click two points');
  mouse('click', 95, 100); // col 3 row 3 -> 135
  expect(container.textContent).toContain('Click a second point');
  mouse('click', 215, 20); // col 7 row 7 -> 175
  const t = container.querySelector('[role="status"]').textContent;
  expect(t).toContain('+29.63%'); // 135 -> 175
  expect(t).toContain('20 min apart');
  expect(t).toMatch(/\$0 .*model estimate/); // column 7 holds no cells
  expect(container.querySelectorAll('[data-testid="measure-point"]')).toHaveLength(2);
  act(() => btn('Clear').click());
  expect(container.querySelectorAll('[data-testid="measure-point"]')).toHaveLength(0);
  act(() => btn('Pan').click());
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test('measure swept sums the second column between the two rows', () => {
  mount();
  act(() => btn('Measure').click());
  mouse('click', 95, 175); // col 3 row 0
  mouse('click', 95, 10); // col 3 row 7
  expect(container.querySelector('[role="status"]').textContent).toContain('$360'); // 10+...+80
});

test('lens, palette and display choices persist and the screenshot downloads a PNG', () => {
  mount();
  const [lens, palette] = container.querySelectorAll('select');
  const set = (el, v) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  set(lens, 'short');
  set(palette, 'coolwarm');
  expect(localStorage.getItem('tm:v1:anon:liquidation.heatLens')).toBe('"short"');
  expect(localStorage.getItem('tm:v1:anon:liquidation.heatPalette')).toBe('"coolwarm"');
  act(() => btn('Display').click());
  act(() => document.querySelectorAll('input[type="checkbox"]')[2].click()); // key levels
  expect(JSON.parse(localStorage.getItem('tm:v1:anon:liquidation.heatDisplay')).keyLevels).toBe(true);
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  act(() => btn('Download heatmap screenshot').click());
  expect(click).toHaveBeenCalled();
  expect(URL.createObjectURL).toHaveBeenCalled();
  click.mockRestore();
});

test('a failing screenshot says so instead of silently doing nothing', () => {
  mount();
  HTMLCanvasElement.prototype.toBlob = (cb) => cb(null);
  act(() => btn('Download heatmap screenshot').click());
  expect(container.textContent).toContain('Screenshot failed');
});

test('defaults reproduce the old controls: full intensity range, 100% readout', () => {
  mount();
  expect(container.querySelector('[data-testid="intensity-readout"]').textContent).toBe('≥ 0% · $0 — ≤ 100% · $1K');
});

test('display toggles change what is drawn: key levels are off by default, the price tag can be hidden', () => {
  const texts = [];
  const rec = new Proxy({}, { get: (t, k) => (k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : k === 'fillText' ? (s) => texts.push(s) : () => {}), set: () => true });
  HTMLCanvasElement.prototype.getContext = () => rec;
  mount();
  expect(texts).toContain('145.00'); // current price tag
  expect(texts).not.toContain('$400'); // key level label
  texts.length = 0;
  act(() => btn('Display').click());
  const boxes = document.querySelectorAll('input[type="checkbox"]');
  act(() => boxes[2].click()); // key levels on
  expect(texts).toContain('$400');
  texts.length = 0;
  act(() => boxes[3].click()); // price line off
  expect(texts).not.toContain('145.00');
});

test('hover works again after a touch (mouse and touch devices); touch pointer moves never move the cursor', () => {
  mount();
  ptr('pointerdown', 95, 100, 'touch');
  ptr('pointermove', 95, 100, 'touch');
  expect(tip()).toBeNull();
  ptr('pointermove', 95, 100, 'mouse');
  expect(tip()).not.toBeNull();
});

test('the card closes on scroll of any parent and on resize, and sits under the AI dock', () => {
  mount();
  mouse('mousemove', 95, 100);
  expect(tip().className).toContain('z-40');
  expect(tip().className).not.toContain('z-[60]');
  act(() => { container.dispatchEvent(new Event('scroll')); }); // a scroll parent: scroll does not bubble, capture sees it
  expect(tip()).toBeNull();
  mouse('mousemove', 95, 100);
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(tip()).toBeNull();
});

test('a refresh error with data keeps the picture and says so, with the time of the data', () => {
  mount({ error: new Error('boom') });
  expect(container.querySelector('canvas')).not.toBeNull();
  expect(container.querySelector('[role="status"]').textContent).toMatch(/Showing data from \d{1,2}:\d{2}.*: refresh failed/);
  mount({ error: null });
  expect(container.textContent).not.toContain('refresh failed');
});

const shifted = () => { const d = DATA(); d.t0 += 300000; d.priceMin += 10; d.generatedAt += 60000; return d; }; // a refresh: one column and one row later

test('a pinned touch card stays on the same time and price after a refresh moves the window', () => {
  mount();
  ptr('pointerdown', 95, 100, 'touch');
  mouse('click', 95, 100); // col 3, row 3: 135
  const head = () => tip().querySelector('span.font-semibold').textContent;
  const before = head();
  const priceBefore = tip().querySelector('.bg-slate-100.font-semibold').textContent;
  mount({ data: shifted() });
  expect(head()).toBe(before); // same time, not the same column index (that would be 5 min later)
  expect(tip().querySelector('.bg-slate-100.font-semibold').textContent).toBe(priceBefore);
  mount({ data: { ...shifted(), t0: shifted().t0 + 20 * 300000 } }); // the cell left the window: the card goes
  expect(tip()).toBeNull();
});

test('measure points follow their time and price across a refresh and hide when outside the window', () => {
  mount();
  act(() => btn('Measure').click());
  mouse('click', 95, 100);
  const first = () => container.querySelector('[role="status"]').textContent;
  const before = first();
  expect(before).toContain('135');
  mount({ data: shifted() });
  expect(first()).toBe(before);
  expect(container.querySelectorAll('[data-testid="measure-point"]')).toHaveLength(1);
  mount({ data: { ...shifted(), t0: shifted().t0 + 20 * 300000 } });
  expect(container.querySelectorAll('[data-testid="measure-point"]')).toHaveLength(0);
});

test('embedded: no panel shell, estimate caption, range tabs and the shared controls; Esc closes the card without reaching the page', () => {
  const onKey = jest.fn();
  document.addEventListener('keydown', onKey);
  mount({ embedded: true });
  expect(container.querySelector('#liq-heatmap')).toBeNull();
  expect(container.querySelector('[data-testid="heat-estimate"]').textContent).toContain('sampled');
  expect(container.querySelector('[aria-label="Heatmap controls"]')).not.toBeNull();
  expect(btn('24h')).toBeTruthy();
  expect(btn('Screenshot')).toBeUndefined();
  act(() => { plot().focus(); plot().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  act(() => { plot().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(onKey).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
  document.removeEventListener('keydown', onKey);
});
