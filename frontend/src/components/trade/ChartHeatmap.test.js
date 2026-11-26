import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import MarketChartPanel from './MarketChartPanel';

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(() => new Promise(() => {})), isCancel: () => false } }));
jest.mock('./CandleChart', () => ({ __esModule: true, default: () => <div data-testid="candles" /> }));
jest.mock('../alerts/AlertsPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../liquidation/LiqHeatmap', () => ({
  __esModule: true,
  default: (p) => <div data-testid="heat" data-symbol={p.symbol} data-embedded={String(!!p.embedded)} data-range={p.range} />,
  RANGES: [{ id: '12h', label: '12h' }, { id: '24h', label: '24h' }],
}));

const candle = { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 };
const draw = (props) => {
  const el = document.createElement('div');
  act(() => { createRoot(el).render(<MarketChartPanel ticker="BTC" interval="1h" onInterval={() => {}} candles={[candle]} ready klineSource="binance-futures" liqSymbol="BTCUSDT" {...props} />); });
  return el;
};
const tab = (el, name) => [...el.querySelectorAll('[role="tab"]')].find((b) => b.textContent === name);

beforeEach(() => localStorage.clear());

test('candles by default: no heatmap mounted', () => {
  const el = draw({});
  expect(el.querySelector('[data-testid="candles"]')).not.toBeNull();
  expect(el.querySelector('[data-testid="heat"]')).toBeNull();
  expect(tab(el, 'Chart').getAttribute('aria-selected')).toBe('true');
});

test('the separate Heatmap tab is gone (heat is an overlay on the candles now), even with a futures symbol', () => {
  expect(tab(draw({}), 'Heatmap')).toBeUndefined();
  localStorage.setItem('tm:v1:anon:chart.view', JSON.stringify('heatmap')); // an old stored choice is ignored
  const el = draw({});
  expect(el.querySelector('[data-testid="heat"]')).toBeNull();
  expect(el.querySelector('[data-testid="candles"]')).not.toBeNull();
});
