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

describe('view tabs', () => {
  const candle = { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 };
  const Host = (props) => {
    const [view, setView] = React.useState(props.initial || 'chart');
    return <MarketChartPanel ticker="BTC" interval="1h" onInterval={() => {}} candles={[candle]} ready klineSource="binance-futures" view={view} onView={setView} alertsSymbol={props.sym} liqSymbol={props.liq} />;
  };
  const mount = (props) => {
    const el = document.createElement('div');
    const root = createRoot(el);
    act(() => { root.render(<Host {...props} />); });
    return { el, root };
  };
  const tab = (el, name) => [...el.querySelectorAll('[role="tab"]')].find((b) => b.textContent.startsWith(name));
  beforeEach(() => localStorage.clear());

  test('Chart and Alerts always shown, no Heatmap tab even with a futures symbol; switching works', () => {
    const spot = mount({ sym: 'MANTRAUSDT' });
    expect(tab(spot.el, 'Chart')).toBeTruthy();
    expect(tab(spot.el, 'Alerts')).toBeTruthy();
    expect(tab(spot.el, 'Heatmap')).toBeUndefined();
    act(() => { tab(spot.el, 'Alerts').click(); });
    expect(tab(spot.el, 'Alerts').getAttribute('aria-selected')).toBe('true');
    act(() => { tab(spot.el, 'Chart').click(); });
    expect(tab(spot.el, 'Chart').getAttribute('aria-selected')).toBe('true');
    expect(tab(mount({ sym: 'BTCUSDT', liq: 'BTCUSDT' }).el, 'Heatmap')).toBeUndefined();
  });

  test('alerts view resets to Chart on symbol change', () => {
    const el = document.createElement('div');
    const root = createRoot(el);
    const render = (sym) => act(() => { root.render(<Host key="h" initial="alerts" sym={sym} />); });
    render('AAAUSDT');
    expect(tab(el, 'Alerts').getAttribute('aria-selected')).toBe('true');
    render('BBBUSDT');
    expect(tab(el, 'Chart').getAttribute('aria-selected')).toBe('true');
  });
});

describe('Liq heatmap overlay', () => {
  const axios = require('axios').default;
  const candle = { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 };
  const grid = { symbol: 'BTCUSDT', t0: 0, colMs: 60000, cols: 2, priceMin: 1, priceStep: 1, rows: 2, cells: [0, 5, 3, 0], max: 5, candles: [{ close: 1 }, { close: 2 }], generatedAt: 1 };
  const draw = (props) => {
    const el = document.createElement('div');
    act(() => { createRoot(el).render(<MarketChartPanel ticker="BTC" interval="1h" onInterval={() => {}} candles={[candle]} ready klineSource="binance-futures" {...props} />); });
    return el;
  };
  const toggle = (el) => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Liq heatmap');
  beforeEach(() => { localStorage.clear(); axios.get.mockReset(); axios.get.mockResolvedValue({ data: grid, headers: {} }); });

  test('hidden without a futures symbol or on no_market; caption shown with one, no request while off', () => {
    expect(draw({}).textContent).not.toContain('Liquidation heatmap:');
    expect(draw({ liqSymbol: 'BTCUSDT', error: 'no_market' }).textContent).not.toContain('Liquidation heatmap:');
    const el = draw({ liqSymbol: 'BTCUSDT' });
    expect(el.textContent).toContain('Liquidation heatmap: estimate from open-interest changes, not exchange data');
    expect(toggle(el).getAttribute('aria-pressed')).toBe('false');
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('toggle persists and requests the shared range; opacity persists', async () => {
    localStorage.setItem('tm:v1:anon:liquidation.heatRange', JSON.stringify('3d')); // the Liquidation page's key
    const el = draw({ liqSymbol: 'BTCUSDT' });
    await act(async () => { toggle(el).click(); });
    expect(axios.get.mock.calls[0][0]).toMatch(/liqheat\/BTCUSDT\?range=3d$/);
    expect(localStorage.getItem('tm:v1:anon:chart.liqHeat')).toBe('true');
    const op = document.body.querySelector('input[aria-label="Heatmap opacity"]');
    expect(op).toBeNull(); // settings closed
    await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === 'Heat settings').click(); });
    const slider = document.body.querySelector('input[aria-label="Heatmap opacity"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => { set.call(slider, '70'); slider.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(localStorage.getItem('tm:v1:anon:chart.liqHeatOpacity')).toBe('70');
  });

  test('palette/lens/intensity come from the Liquidation page keys', async () => {
    localStorage.setItem('tm:v1:anon:liquidation.heatPalette', JSON.stringify('inferno'));
    localStorage.setItem('tm:v1:anon:chart.liqHeat', 'true');
    const el = draw({ liqSymbol: 'BTCUSDT' });
    await act(async () => {});
    await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === 'Heat settings').click(); });
    expect([...document.body.querySelectorAll('[aria-label="Heatmap settings"][role="group"]')].pop().querySelector('select').value).toBe('inferno');
  });
});
