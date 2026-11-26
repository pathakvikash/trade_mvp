import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LiqMap from './LiqMap';
import usePolling from '../../lib/usePolling';

jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./useCanvas', () => ({ __esModule: true, default: () => ({ wrap: { current: null }, canvas: { current: null } }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;
const DATA = { symbol: 'BTCUSDT', price: 100, generatedAt: 1700000000000, method: 'm', levels: [{ price: 90, longUsd: 5, shortUsd: 0 }, { price: 110, longUsd: 0, shortUsd: 7 }] };

test('a failed refresh keeps the map and shows a refresh-failed note with the data time', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  usePolling.mockReturnValue({ data: DATA, error: new Error('x'), loading: false, source: null });
  act(() => root.render(<LiqMap symbol="BTCUSDT" />));
  expect(container.querySelector('canvas')).not.toBeNull();
  expect(container.querySelector('[role="status"]').textContent).toMatch(/Showing data from \d{1,2}:\d{2}.*: refresh failed/);
  usePolling.mockReturnValue({ data: DATA, error: null, loading: false, source: null });
  act(() => root.render(<LiqMap symbol="BTCUSDT" />));
  expect(container.querySelector('[role="status"]')).toBeNull();
  act(() => root.unmount());
});

describe('liquidation map UI', () => {
  const TIERS = [{ id: 'a', label: '<=10x' }, { id: 'b', label: '50x' }];
  const TDATA = {
    ...DATA, tiers: TIERS,
    levels: [
      { price: 90, longUsd: 30, shortUsd: 0, longTier: [10, 20], shortTier: [0, 0] },
      { price: 98, longUsd: 6, shortUsd: 0, longTier: [4, 2], shortTier: [0, 0] },
      { price: 101, longUsd: 0, shortUsd: 8, longTier: [0, 0], shortTier: [3, 5] },
      { price: 110, longUsd: 0, shortUsd: 40, longTier: [0, 0], shortTier: [40, 0] },
    ],
  };
  let container; let root; let origRect;
  beforeEach(() => {
    origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 });
    usePolling.mockReturnValue({ data: TDATA, error: null, loading: false, source: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<LiqMap symbol="BTCUSDT" />));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); Element.prototype.getBoundingClientRect = origRect; });
  const btn = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));
  const level = () => container.querySelector('[data-testid="zoom-level"]').textContent;

  test('header, 4 stat cards and the honest estimate note render', () => {
    expect(container.textContent).toContain('BTC');
    expect(container.querySelector('[data-testid="liqmap-status"]').textContent).toMatch(/Live/);
    const stats = container.querySelector('[data-testid="liqmap-stats"]').textContent;
    expect(stats).toMatch(/Long liq within 2%/);
    expect(stats).toMatch(/Short liq within 2%/);
    expect(stats).toMatch(/Biggest cluster/);
    expect(stats).toMatch(/Long vs short total/);
    expect(stats).toContain('+10.00% from price');
    expect(container.textContent).toMatch(/inferred from open-interest changes/);
    expect(btn('Refresh')).toBeTruthy();
    expect(btn('Screenshot')).toBeTruthy();
  });

  test('legend toggles a tier: pressed state flips and totals drop', () => {
    const t = btn('50x');
    expect(t.getAttribute('aria-pressed')).toBe('true');
    expect(t.className).toContain('min-h-[44px]');
    expect(container.textContent).toContain('Longs below price: $36');
    act(() => t.click());
    expect(btn('50x').getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('Longs below price: $14');
  });

  test('hover tooltip shows bucket, tier $, cumulative long/short and distance', () => {
    const area = container.querySelector('[aria-label^="Liquidation map."]');
    // plot spans x 44..348 of the 400px stub; 0.5 of the plot is the middle of the 4-level span
    act(() => { area.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 100 })); });
    const tip = container.querySelector('[data-testid="liqmap-tip"]');
    expect(tip).not.toBeNull();
    expect(tip.textContent).toContain('90');
    expect(tip.textContent).toContain('-10.00%');
    expect(tip.textContent).toMatch(/Long \$10/);
    expect(tip.textContent).toMatch(/Cumulative long \$36/);
    expect(tip.textContent).toMatch(/Cumulative short \$0/);
  });

  test('range chip and brush stay in sync with the zoom level', () => {
    expect(level()).toBe('1x');
    act(() => btn('±5%').click());
    expect(parseFloat(level())).toBeGreaterThan(1);
    expect(btn('±5%').getAttribute('aria-pressed')).toBe('true');
    const r = container.querySelector('[data-testid="brush-r"]');
    const before = r.getAttribute('aria-valuenow');
    act(() => { r.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); });
    expect(Number(r.getAttribute('aria-valuenow'))).toBeGreaterThan(Number(before));
    expect(btn('±5%').getAttribute('aria-pressed')).toBe('false'); // window changed, chip no longer matches
    act(() => btn('All').click());
    expect(level()).toBe('1x');
    expect(container.querySelector('[data-testid="brush-l"]').getAttribute('aria-valuenow')).toBe('0');
    // zoom buttons move the brush too
    act(() => container.querySelector('button[aria-label^="Zoom in"]').click());
    expect(container.querySelector('[data-testid="brush-r"]').getAttribute('aria-valuenow')).toBe('83');
  });
});
