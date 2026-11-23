import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('lightweight-charts', () => ({ LineStyle: { Solid: 0, Dashed: 2 }, createChart: jest.fn() }));
jest.mock('../alerts/AlertsPanel', () => ({ __esModule: true, default: () => null }));

import { createChart } from 'lightweight-charts';
import MarketChartPanel from '../trade/MarketChartPanel';
import StatChart from '../derivatives/StatChart';

const stub = () => ({ setData: jest.fn(), update: jest.fn(), applyOptions: jest.fn(), createPriceLine: jest.fn(), removePriceLine: jest.fn() });
const chartStub = () => ({
  addCandlestickSeries: stub, addHistogramSeries: stub, addLineSeries: stub, removeSeries: jest.fn(),
  priceScale: () => ({ applyOptions: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }),
  subscribeCrosshairMove: jest.fn(), remove: jest.fn(),
});

let container;
let root;
beforeEach(() => { createChart.mockImplementation(chartStub); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); document.documentElement.style.overflow = ''; });

const candles = [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
const panel = () => <MarketChartPanel ticker="BTCUSDT" interval="1h" onInterval={() => {}} candles={candles} ready reloadSeq={0} />;
const btn = () => container.querySelector('button[aria-pressed][aria-label$="chart"]');
const section = () => container.querySelector('section');

test('toggle adds/removes fixed classes, aria-pressed flips, focus stays, createChart once', () => {
  act(() => root.render(panel()));
  const b = btn();
  b.focus();
  expect(b.getAttribute('aria-pressed')).toBe('false');
  expect(b.getAttribute('aria-label')).toBe('Maximise chart');
  act(() => b.click());
  expect(btn()).toBe(b);
  expect(document.activeElement).toBe(b);
  expect(b.getAttribute('aria-pressed')).toBe('true');
  expect(b.getAttribute('aria-label')).toBe('Restore chart');
  expect(section().className).toContain('!fixed');
  expect(section().getAttribute('role')).toBe('region');
  expect(document.documentElement.style.overflow).toBe('hidden');
  expect(container.querySelector('.z-40.fixed.inset-0')).not.toBeNull();
  act(() => b.click());
  expect(section().className).not.toContain('!fixed');
  expect(document.documentElement.style.overflow).toBe('');
  expect(createChart).toHaveBeenCalledTimes(1);
});

test('Esc restores', () => {
  act(() => root.render(panel()));
  act(() => btn().click());
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(btn().getAttribute('aria-pressed')).toBe('false');
  expect(section().className).not.toContain('!fixed');
});

test('unmount while maximised restores html overflow', () => {
  act(() => root.render(panel()));
  act(() => btn().click());
  act(() => root.render(null));
  expect(document.documentElement.style.overflow).toBe('');
});

test('StatChart fill does not recreate the chart', () => {
  const series = [{ kind: 'line', color: '#fff', data: [{ time: 1, value: 1 }] }];
  act(() => root.render(<StatChart series={series} label="x" />));
  act(() => root.render(<StatChart series={series} label="x" fill />));
  expect(createChart).toHaveBeenCalledTimes(1);
  expect(container.firstChild.style.height).toBe('100%');
});
