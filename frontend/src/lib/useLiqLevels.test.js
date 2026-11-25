import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import useLiqLevels, { buildLiqLines } from './useLiqLevels';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), isCancel: () => false } }));

let out;
const Probe = ({ symbol = 'BTCUSDT', enabled }) => { out = useLiqLevels(symbol, enabled); return null; };
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { axios.get.mockReset(); jest.useFakeTimers(); });
afterEach(() => jest.useRealTimers());

const levels = [
  { price: 110, shortUsd: 35.2e6, longUsd: 0 }, { price: 105, shortUsd: 1e6, longUsd: 0 },
  { price: 95, shortUsd: 0, longUsd: 10e6 }, { price: 90, shortUsd: 0, longUsd: 2e6 },
];
const reply = (extra) => ({ data: { symbol: 'BTCUSDT', price: 100, generatedAt: 1, levels, ...extra }, headers: {} });

test('buildLiqLines: shorts above, longs below, top 8, compact label on the biggest only, width by size', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ price: 101 + i, shortUsd: (i + 1) * 1e6, longUsd: 0 }));
  const l = buildLiqLines(many, 100, 1);
  expect(l).toHaveLength(8);
  expect(l.filter((x) => x.title)).toHaveLength(1);
  expect(l[0]).toMatchObject({ title: '$12M short', width: 3 });
  const b = buildLiqLines(levels, 100, 4);
  expect(b.map((x) => x.title)).toEqual(['$35.2M short', '$1M short', '$10M long', '$2M long']);
  expect(b[0].color).toContain('251');
  expect(b[2].color).toContain('52,211');
});

test('disabled: no request, no lines; enabling fetches; refreshes every 60 s; disabling clears', async () => {
  axios.get.mockResolvedValue(reply());
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe enabled={false} />); });
  expect(axios.get).not.toHaveBeenCalled();
  expect(out.lines).toEqual([]);

  await act(async () => { root.render(<Probe enabled />); });
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][0]).toMatch(/\/liqmap\/BTCUSDT$/);
  expect(out.lines).toHaveLength(4);
  expect(out.error).toBeNull();

  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(axios.get).toHaveBeenCalledTimes(2);

  await act(async () => { root.render(<Probe enabled={false} />); });
  expect(out.lines).toEqual([]);
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(axios.get).toHaveBeenCalledTimes(2);
});

test('503 degraded gives an error and no lines; source comes from the body', async () => {
  axios.get.mockRejectedValue({ response: { status: 503 } });
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe enabled />); });
  expect(out.error).toBeTruthy();
  expect(out.lines).toEqual([]);

  axios.get.mockResolvedValue(reply({ source: 'bybit', symbol: 'ETHUSDT' }));
  await act(async () => { root.render(<Probe enabled symbol="ETHUSDT" />); });
  expect(out.error).toBeNull();
  expect(out.source).toBe('bybit');
});
