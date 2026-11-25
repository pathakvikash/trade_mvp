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
const active = (o = {}) => ({ spec: { name: 'Cross' }, symbol: 'BTCUSDT', kind: 'perp', interval: '1h', allTimeframes: false, result: RESULT, ...o });
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
  expect(out.chip.mismatch).toMatch(/Not drawn on 5m: pinned to 1h/);
  expect(out.chip.mismatch).toMatch(/Switch the chart/);
  expect(axios.post).not.toHaveBeenCalled(); // pinned: never evaluates another timeframe
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

describe('all timeframes', () => {
  const all = (o = {}) => active({ allTimeframes: true, ...o });
  const ok = (trades) => ({ data: { ...RESULT, stats: { trades, winRate: 10 } } });

  test('draws the initial result on its own interval with no request', () => {
    useStrategyStore.setState({ active: all() });
    show();
    expect(axios.post).not.toHaveBeenCalled();
    expect(out.overlays).toHaveLength(1);
    expect(out.chip).toMatchObject({ mode: 'all', interval: '1h', trades: 4 });
  });

  test('a timeframe change re-evaluates the same spec on that interval (debounced), then draws it', async () => {
    useStrategyStore.setState({ active: all() });
    show();
    show({ interval: '5m', candles: cs(11) });
    expect(out.overlays).toBeUndefined(); // 1h result is never drawn on 5m
    expect(out.chip).toMatchObject({ pending: true, interval: '5m' });
    expect(axios.post).not.toHaveBeenCalled();
    axios.post.mockResolvedValueOnce(ok(33));
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1]).toEqual({ spec: { name: 'Cross' }, kind: 'perp', symbol: 'BTCUSDT', interval: '5m' });
    expect(out.chip).toMatchObject({ trades: 33, interval: '5m' });
    expect(out.overlays).toHaveLength(1);
  });

  test('rapid switches abort the previous request and only the last interval is evaluated; 30 s cache per interval', async () => {
    useStrategyStore.setState({ active: all() });
    show();
    show({ interval: '5m', candles: cs(11) });
    await act(async () => { jest.advanceTimersByTime(300); });
    const first = axios.post.mock.calls[0][2].signal;
    show({ interval: '15m', candles: cs(12) });
    expect(first.aborted).toBe(true);
    show({ interval: '4h', candles: cs(13) }); // debounced away
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(axios.post.mock.calls.map((c) => c[1].interval)).toEqual(['5m', '4h']);
    // back to 5m within 30 s: cached, no request
    axios.post.mockClear();
    show({ interval: '5m', candles: cs(11) });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(axios.post).not.toHaveBeenCalled();
    expect(out.overlays).toHaveLength(1);
    // back to the initial interval: no request either
    show({ interval: '1h', candles: cs(10) });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(axios.post).not.toHaveBeenCalled();
    // after 30 s the cache is stale
    await act(async () => { jest.advanceTimersByTime(31000); });
    show({ interval: '5m', candles: cs(11) });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('server 400 on an interval shows not available, draws nothing', async () => {
    useStrategyStore.setState({ active: all() });
    show();
    axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'interval not available for this market' } } });
    show({ interval: '4h', candles: cs(11) });
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(out.chip).toMatchObject({ unavailable: true });
    expect(out.chip.error).toBeNull();
    expect(out.overlays).toBeUndefined();
  });

  test('toggling off pins it: not drawn on another timeframe and no request', async () => {
    useStrategyStore.setState({ active: all() });
    show({ interval: '5m', candles: cs(11) });
    axios.post.mockClear();
    act(() => useStrategyStore.getState().setAllTimeframes(false));
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(out.chip).toMatchObject({ mode: 'pinned' });
    expect(out.chip.mismatch).toMatch(/pinned to 1h/);
    expect(out.overlays).toBeUndefined();
    expect(axios.post).not.toHaveBeenCalled();
  });
});
