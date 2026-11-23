import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import useStrategyOverlay from './useStrategyOverlay';
import useStrategyStore from '../store/strategyStore';
import useUserStore from '../store/userStore';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;
const RESULT = { series: { fast: [{ time: 1, value: 1 }] }, markers: [{ time: 1, kind: 'entry_long', price: 1 }], stats: { trades: 4, winRate: 50 } };
const active = (o = {}) => ({ spec: { name: 'Cross' }, symbol: 'BTCUSDT', kind: 'perp', interval: '1h', result: RESULT, ...o });
const cs = (t) => [{ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 }];

let out;
const Probe = (p) => { out = useStrategyOverlay(p); return null; };
let root;
const show = (props) => act(() => root.render(<Probe kind="perp" symbol="BTCUSDT" interval="1h" candles={cs(10)} {...props} />));

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1e12);
  axios.post.mockResolvedValue({ data: { ...RESULT, stats: { trades: 9, winRate: 60 } } });
  useUserStore.setState({ token: 't' });
  useStrategyStore.setState({ active: null });
  root = createRoot(document.createElement('div'));
});
afterEach(() => { act(() => root.unmount()); jest.useRealTimers(); jest.clearAllMocks(); });

test('nothing without an active strategy; no evaluate call', () => {
  show();
  expect(out.chip).toBeNull();
  expect(out.overlays).toBeUndefined();
  show({ candles: cs(20) });
  expect(axios.post).not.toHaveBeenCalled();
});

test('matching strategy yields overlays, markers, chip with stats', () => {
  useStrategyStore.setState({ active: active() });
  show();
  expect(out.overlays).toEqual([expect.objectContaining({ id: 'fast' })]);
  expect(out.markers).toHaveLength(1);
  expect(out.chip).toMatchObject({ name: 'Cross', trades: 4, winRate: 50 });
});

test('symbol or interval mismatch draws nothing and the chip says switch', () => {
  useStrategyStore.setState({ active: active() });
  show({ interval: '5m' });
  expect(out.overlays).toBeUndefined();
  expect(out.chip.mismatch).toMatch(/Switch the chart/);
  show({ symbol: 'ETHUSDT' });
  expect(out.markers).toBeUndefined();
});

test('re-evaluates on a new candle, throttled to once per 30 s', async () => {
  useStrategyStore.setState({ active: active() });
  show();
  show({ candles: cs(20) }); // new candle inside the 30 s window: deferred
  expect(axios.post).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1]).toMatchObject({ kind: 'perp', symbol: 'BTCUSDT', interval: '1h', spec: { name: 'Cross' } });
  expect(out.chip.trades).toBe(9);
  await act(async () => { jest.advanceTimersByTime(31000); });
  await act(async () => { root.render(<Probe kind="perp" symbol="BTCUSDT" interval="1h" candles={cs(30)} />); }); // later than 30 s: immediate; the reply settles inside act
  expect(axios.post).toHaveBeenCalledTimes(2);
});

test('a new strategy cancels the pending re-evaluation and the in-flight one', async () => {
  useStrategyStore.setState({ active: active() });
  show();
  show({ candles: cs(20) }); // deferred by the throttle
  act(() => useStrategyStore.setState({ active: active({ spec: { name: 'Other' } }) }));
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(axios.post).not.toHaveBeenCalled(); // the old timer is gone
  // in flight when the chart unmounts: aborted, nothing set afterwards
  show({ candles: cs(30) });
  await act(async () => { jest.advanceTimersByTime(30000); });
  expect(axios.post).toHaveBeenCalledTimes(1);
  const { signal } = axios.post.mock.calls[0][2];
  act(() => root.unmount());
  expect(signal.aborted).toBe(true);
  root = createRoot(document.createElement('div')); // for afterEach
});
