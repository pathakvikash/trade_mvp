import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Derivatives from './Derivatives';
import usePolling from '../lib/usePolling';

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

const render = async ({ ov, st, kl }) => {
  usePolling.mockImplementation((url) => (url.includes('/overview') ? ov : url.includes('/stats/') ? st : kl));
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
