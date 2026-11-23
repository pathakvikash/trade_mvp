import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Derivatives from './Derivatives';
import usePolling from '../lib/usePolling';
import useAgentStore from '../store/agentStore';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('lightweight-charts', () => ({ createChart: jest.fn() }));
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../components/derivatives/StatChart', () => ({ __esModule: true, default: () => null }));

const OV = [{ symbol: 'BTCUSDT', lastPrice: 60000, priceChangePercent: 1, fundingRate: 0.0001, fundingIntervalHours: 8, openInterestUsd: null, nextFundingTime: 0, quoteVolume: 5e9 }];
const STATS = { openInterest: [], longShort: [], topLongShort: [], takerBuySell: [], funding: [] };

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });

const render = async ({ ov, st, kl, sy = ok(null) }) => {
  usePolling.mockImplementation((url) => (!url ? ok(null) : url.includes('/overview') ? ov : url.includes('/stats/') ? st : url.includes('/symbols') ? sy : kl));
  await act(async () => { root.render(<Derivatives />); });
  return container.textContent;
};
const ok = (data, source = null) => ({ data, source, error: null, loading: false });

test('degraded stats show the unavailable note; ws overview shows the OI note without null/NaN', async () => {
  const text = await render({ ov: ok(OV, 'ws'), st: ok({ ...STATS, degraded: true, source: 'unavailable' }), kl: ok([]) });
  expect(text).toContain('Positioning data (open interest, long/short ratios) is unavailable from this server');
  expect(text).toContain('Open interest unavailable from this server');
  expect(text).not.toMatch(/null|NaN/);
});

test('spot klines note on the price line; no notes for a normal source', async () => {
  let text = await render({ ov: ok(OV), st: ok(STATS), kl: ok([], 'spot') });
  expect(text).toContain('spot candles');
  act(() => root.unmount());
  root = createRoot(container);
  text = await render({ ov: ok(OV, 'binance-futures'), st: ok(STATS), kl: ok([], 'binance-futures') });
  expect(text).not.toMatch(/unavailable from this server|spot candles/);
});

test('bybit source: notes on price line, positioning and OI column; empty top/taker series render without errors', async () => {
  const oi = [{ ...OV[0], openInterestUsd: 2.5e9 }];
  const text = await render({ ov: ok(oi, 'ws'), st: ok({ ...STATS, source: 'bybit' }, 'bybit'), kl: ok([], 'bybit') });
  expect(text).toContain('Price line uses Bybit perpetual candles');
  expect(text).toContain('are from Bybit');
  expect(text).toContain('Open interest is Bybit perpetuals open interest');
  expect(text).not.toContain('Open interest unavailable from this server');
  expect(text).not.toMatch(/null|NaN/);
});

test('picker lists a symbol outside the overview and selecting it requests that symbol', async () => {
  await render({ ov: ok(OV, 'ws'), st: ok(STATS), kl: ok([]), sy: ok(['BTCUSDT', 'ETHUSDT', 'SKYAIUSDT'].map((symbol) => ({ symbol }))) });
  const input = container.querySelector('input[role="combobox"]');
  await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
  const opt = [...container.querySelectorAll('[role="option"]')].find((o) => o.textContent.startsWith('SKYAI'));
  expect(opt).toBeTruthy();
  usePolling.mockClear();
  await act(async () => { opt.click(); });
  expect(usePolling.mock.calls.some(([u]) => u.includes('/stats/SKYAIUSDT'))).toBe(true);
});

test('gate source shows a Gate-specific note', async () => {
  const text = await render({ ov: ok(OV), st: ok(STATS, 'gate'), kl: ok([], 'gate') });
  expect(text).toContain('Price line uses Gate perpetual candles');
  expect(text).toContain('are from Gate');
});

test('Ask AI opens the dock with the derivatives page context', async () => {
  await render({ ov: ok(OV), st: ok(STATS), kl: ok([]) });
  act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Ask AI').click());
  expect(useAgentStore.getState().ctx).toMatchObject({ kind: 'perp', symbol: 'BTCUSDT', page: 'derivatives', interval: '1h' });
});
