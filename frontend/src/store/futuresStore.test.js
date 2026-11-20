import axios from 'axios';
import useFuturesStore from './futuresStore';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
const mockHandlers = {};
const mockEmit = jest.fn();
jest.mock('../lib/socket', () => ({ getFuturesSocket: () => ({ on: (ev, fn) => { mockHandlers[ev] = fn; }, emit: mockEmit, connected: false }) }));

const candle = (time, close) => ({ time, open: close, high: close, low: close, close, volume: 1 });
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('a late 1m response does not pollute a higher timeframe chart', async () => {
  const oneMin = deferred();
  axios.get.mockImplementation((url, { params } = {}) => {
    if (url.includes('/liquidations/')) return Promise.resolve({ data: { events: [], since: 1 } });
    return params.interval === '1m' ? oneMin.promise : Promise.resolve({ data: [candle(300, 5)] });
  });

  const sub = useFuturesStore.getState().subscribe('BTCUSDT');
  useFuturesStore.getState().setTimeframe('5m');
  await new Promise((r) => setTimeout(r, 0)); // 5m + liquidations land
  oneMin.resolve({ data: [candle(60, 1), candle(120, 2)] });
  await sub;

  const s = useFuturesStore.getState();
  expect(s.interval).toBe('5m');
  expect(s.candles).toEqual([candle(300, 5)]);
});

test('a successful reload clears load_failed; no_market blocks timeframe changes', async () => {
  axios.get.mockResolvedValue({ data: [candle(60, 1)] });
  useFuturesStore.setState({ symbol: 'BTCUSDT', interval: '1m', error: 'load_failed' });
  useFuturesStore.getState().setTimeframe('5m');
  await new Promise((r) => setTimeout(r, 0));
  expect(useFuturesStore.getState().error).toBeNull();

  useFuturesStore.setState({ error: 'no_market' });
  useFuturesStore.getState().setTimeframe('1h');
  expect(useFuturesStore.getState().interval).toBe('5m');
});

test('first socket connect does not refetch klines; a reconnect does; futures:error sets load_failed', async () => {
  axios.get.mockImplementation((url) => Promise.resolve({ data: url.includes('/liquidations/') ? { events: [], since: 1 } : [candle(60, 1)] }));
  await useFuturesStore.getState().subscribe('ETHUSDT'); // wires the socket
  axios.get.mockClear();
  mockHandlers.connect();
  expect(axios.get).not.toHaveBeenCalled();
  mockHandlers.connect();
  expect(axios.get).toHaveBeenCalledTimes(1);
  await new Promise((r) => setTimeout(r, 0));
  mockHandlers['futures:error']({ message: 'x' });
  expect(useFuturesStore.getState().error).toBe('load_failed');
});
