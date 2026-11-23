import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import usePolling from './usePolling';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), isCancel: () => false } }));

let out;
const Probe = () => { out = usePolling('/x', 60000); return null; };

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

const run = async (headers) => {
  axios.get.mockResolvedValue({ data: [1], headers });
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe />); });
  act(() => root.unmount());
};

test('exposes the X-Data-Source header as source', async () => {
  await run({ 'x-data-source': 'ws' });
  expect(out.source).toBe('ws');
  expect(out.data).toEqual([1]);
});

test('source is null when the header is absent', async () => {
  await run({});
  expect(out.source).toBeNull();
});

describe('retry option', () => {
  const Retrying = ({ retry }) => { out = usePolling('/x', 60000, 0, undefined, retry); return null; };
  const mount = async (retry) => {
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<Retrying retry={retry} />); });
    return root;
  };
  const tick = (ms) => act(async () => { jest.advanceTimersByTime(ms); });
  beforeEach(() => { jest.useFakeTimers(); axios.get.mockReset(); });
  afterEach(() => jest.useRealTimers());

  test('after an error with no data, refetches at 5 s then 15 s, then leaves it to the 60 s poll', async () => {
    axios.get.mockRejectedValue(new Error('waking'));
    const root = await mount(true);
    expect(axios.get).toHaveBeenCalledTimes(1);
    await tick(4900);
    expect(axios.get).toHaveBeenCalledTimes(1);
    await tick(200);
    expect(axios.get).toHaveBeenCalledTimes(2);
    await tick(14900);
    expect(axios.get).toHaveBeenCalledTimes(2);
    await tick(200);
    expect(axios.get).toHaveBeenCalledTimes(3);
    await tick(40000); // no third quick retry; the next fetch is the 60 s interval
    expect(axios.get).toHaveBeenCalledTimes(3);
    await tick(21000);
    expect(axios.get).toHaveBeenCalledTimes(4);
    act(() => root.unmount());
  });

  test('stops retrying once data arrives', async () => {
    axios.get.mockRejectedValueOnce(new Error('waking')).mockResolvedValue({ data: [1], headers: {} });
    const root = await mount(true);
    await tick(5100);
    expect(out.data).toEqual([1]);
    await tick(20000);
    expect(axios.get).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  test('without the option a failure waits for the normal poll', async () => {
    axios.get.mockRejectedValue(new Error('x'));
    const root = await mount(false);
    await tick(30000);
    expect(axios.get).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });
});
