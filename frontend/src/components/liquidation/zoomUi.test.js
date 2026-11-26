import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LiqHeatmap from './LiqHeatmap';
import LiqMap from './LiqMap';
import usePolling from '../../lib/usePolling';

jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const HEAT = () => {
  const d = { cols: 10, rows: 8, t0: 1700000000000, colMs: 300000, priceMin: 100, priceStep: 10, price: 145, max: 1000, generatedAt: 1700003000000, cells: [], candles: [], totals: { longUsd: 5, shortUsd: 6 }, largest: null };
  for (let c = 0; c < 10; c += 1) { d.candles.push({ open: 140, close: 141, high: 150, low: 130 }); for (let r = 0; r < 8; r += 1) d.cells.push(c === 3 ? (r + 1) * 10 : 0); }
  return d;
};
const MAP = { symbol: 'BTCUSDT', price: 100, generatedAt: 1700000000000, method: 'm', levels: [{ price: 90, longUsd: 5, shortUsd: 0 }, { price: 110, longUsd: 0, shortUsd: 7 }] };
const stub = new Proxy({}, { get: (t, k) => (k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => {}), set: () => true });

let container; let root; let origGet; let origRect;
beforeEach(() => {
  localStorage.clear();
  origGet = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = () => stub;
  global.ResizeObserver = class { observe() {} disconnect() {} };
  origRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 });
  usePolling.mockReturnValue({ data: MAP, error: null, loading: false, source: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); HTMLCanvasElement.prototype.getContext = origGet; Element.prototype.getBoundingClientRect = origRect; });

const heat = (extra = {}) => act(() => root.render(<LiqHeatmap symbol="BTCUSDT" range="24h" onRange={() => {}} data={HEAT()} source={null} loading={false} error={null} onRefresh={() => {}} refreshing={false} {...extra} />));
const map = (symbol = 'BTCUSDT') => act(() => root.render(<LiqMap symbol={symbol} />));
const click = (label) => act(() => container.querySelector(`button[aria-label^="${label}"]`).click());
const level = () => container.querySelector('[data-testid="zoom-level"]').textContent;
const wheel = (el, init) => { const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 150, clientY: 100, deltaY: -100, ...init }); act(() => { el.dispatchEvent(e); }); return e; };
const surfaces = [
  ['heatmap', () => heat(), () => container.querySelector('[aria-label^="Heatmap cell cursor"]')],
  ['embedded heatmap', () => heat({ embedded: true }), () => container.querySelector('[aria-label^="Heatmap cell cursor"]')],
  ['liquidation map', () => map(), () => container.querySelector('[aria-label^="Liquidation map."]')],
];

describe.each(surfaces)('%s zoom', (name, mount, area) => {
  test('buttons zoom in and out, Reset returns to 1x, labels and 44px targets', () => {
    mount();
    expect(level()).toBe('1x');
    expect(container.querySelector('button[aria-label^="Zoom out"]').disabled).toBe(true);
    click('Zoom in'); click('Zoom in');
    expect(level()).toBe('2.3x');
    click('Zoom out');
    expect(level()).toBe('1.5x');
    expect(container.querySelector('button[aria-label^="Zoom in"]').className).toContain('min-h-[44px]');
    click('Reset zoom');
    expect(level()).toBe('1x');
  });

  test('plain wheel is left to the page; Ctrl/Cmd+wheel zooms and prevents default', async () => {
    mount();
    expect(wheel(area(), {}).defaultPrevented).toBe(false);
    expect(level()).toBe('1x');
    expect(wheel(area(), { ctrlKey: true }).defaultPrevented).toBe(true);
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)); }); // wheel zoom is applied once per frame
    expect(parseFloat(level())).toBeGreaterThan(1);
    expect(wheel(area(), { metaKey: true }).defaultPrevented).toBe(true);
  });

  test('keys + - 0 and double-click', () => {
    mount();
    const key = (k) => act(() => { area().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
    key('+'); key('+');
    expect(level()).toBe('2.3x');
    key('-');
    expect(level()).toBe('1.5x');
    key('0');
    expect(level()).toBe('1x');
    key('+');
    act(() => { area().dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    expect(level()).toBe('1x');
  });

  test('zoom is off when touch-action would swallow page scroll: pan-y is set', () => {
    mount();
    expect(area().style.touchAction).toBe('pan-y');
  });
});

test('zoom resets when the symbol changes (map) or the range changes (heatmap)', () => {
  map();
  click('Zoom in'); click('Zoom in');
  expect(level()).toBe('2.3x');
  usePolling.mockReturnValue({ data: { ...MAP, symbol: 'ETHUSDT' }, error: null, loading: false, source: null });
  map('ETHUSDT');
  expect(level()).toBe('1x');
  heat();
  click('Zoom in');
  heat({ range: '1w' });
  expect(level()).toBe('1x');
});
