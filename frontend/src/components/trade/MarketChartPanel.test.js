import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import MarketChartPanel from './MarketChartPanel';

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), isCancel: () => false } }));
jest.mock('./CandleChart', () => ({ __esModule: true, default: () => null }));
jest.mock('../alerts/AlertsPanel', () => ({ __esModule: true, default: () => null }));

const text = (interval) => {
  const el = document.createElement('div');
  act(() => {
    createRoot(el).render(<MarketChartPanel ticker="PERP" interval={interval} onInterval={() => {}} candles={[]} ready klineSource="unavailable" />);
  });
  return el.textContent;
};

test('empty unavailable history: 1m says live candles build up, other timeframes say to switch to 1m', () => {
  expect(text('1m')).toContain('live candles will build up');
  expect(text('1h')).toContain('Switch to 1m for live candles.');
  expect(text('1h')).not.toContain('will build up');
});

test('bybit candles show the Bybit source note', () => {
  const el = document.createElement('div');
  const candle = { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 };
  act(() => {
    createRoot(el).render(<MarketChartPanel ticker="PERP" interval="1h" onInterval={() => {}} candles={[candle]} ready klineSource="bybit" />);
  });
  expect(el.textContent).toContain('Candles from Bybit perpetuals (Binance futures history unavailable from this server)');
});

test('header controls wrap instead of widening the page on narrow screens', () => {
  const el = document.createElement('div');
  act(() => { createRoot(el).render(<MarketChartPanel ticker="PERP" interval="1h" onInterval={() => {}} candles={[]} ready klineSource="unavailable" />); });
  const group = el.querySelector('[role="tablist"], [aria-label="Timeframe"]').parentElement;
  expect(group.className).toContain('flex-wrap');
  expect(group.className).toContain('min-w-0');
});

describe('Liq levels toggle', () => {
  const axios = require('axios').default;
  const candle = { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 };
  const draw = (props) => {
    const el = document.createElement('div');
    act(() => { createRoot(el).render(<MarketChartPanel ticker="BTC" interval="1h" onInterval={() => {}} candles={[candle]} ready klineSource="binance-futures" {...props} />); });
    return el;
  };
  beforeEach(() => { localStorage.clear(); axios.get.mockReset(); axios.get.mockRejectedValue({ response: { status: 503 } }); });

  test('absent without liqSymbol; present, off by default, no request while off', () => {
    expect(draw({}).textContent).not.toContain('Liq levels');
    const el = draw({ liqSymbol: 'BTCUSDT' });
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Liq levels');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('turning on persists, requests the map and shows the unavailable note on 503', async () => {
    const el = draw({ liqSymbol: 'BTCUSDT' });
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Liq levels');
    await act(async () => { btn.click(); });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(axios.get.mock.calls[0][0]).toMatch(/liqmap\/BTCUSDT$/);
    expect(el.textContent).toContain('Liquidation map unavailable');
    const el2 = draw({ liqSymbol: 'BTCUSDT' }); // remembered
    await act(async () => {});
    expect([...el2.querySelectorAll('button')].find((b) => b.textContent === 'Liq levels').getAttribute('aria-pressed')).toBe('true');
  });
});
