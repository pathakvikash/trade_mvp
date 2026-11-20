import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockCandle = {};
jest.mock('lightweight-charts', () => ({ LineStyle: { Solid: 0, Dashed: 2 }, createChart: jest.fn() }));

import { createChart } from 'lightweight-charts';
import CandleChart from './CandleChart';

const candles = [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
const L = (o) => ({ id: 'a', price: 100, title: 'Long', color: '#22d3ee', style: 'solid', kind: 'entry', ...o });
const ui = (lines) => <CandleChart candles={candles} reloadSeq={0} label="x" lines={lines} />;

beforeEach(() => {
  Object.assign(mockCandle, {
    applyOptions: jest.fn(), setData: jest.fn(), update: jest.fn(),
    createPriceLine: jest.fn(() => ({ applyOptions: jest.fn() })), removePriceLine: jest.fn(),
  });
  createChart.mockImplementation(() => ({
    addCandlestickSeries: () => mockCandle,
    addHistogramSeries: () => ({ setData: jest.fn(), update: jest.fn() }),
    priceScale: () => ({ applyOptions: jest.fn() }),
    subscribeCrosshairMove: jest.fn(),
    remove: jest.fn(),
  }));
});

const mount = (node) => {
  const root = createRoot(document.createElement('div'));
  act(() => root.render(node));
  return { rerender: (n) => act(() => root.render(n)) };
};
const render = mount;

test('creates, updates in place, and removes price lines', () => {
  const { rerender } = render(ui([L(), L({ id: 'b', kind: 'liq', style: 'dashed' })]));
  expect(mockCandle.createPriceLine).toHaveBeenCalledTimes(2);
  expect(mockCandle.createPriceLine.mock.calls[0][0]).toMatchObject({ lineWidth: 2, lineStyle: 0, axisLabelVisible: true });
  expect(mockCandle.createPriceLine.mock.calls[1][0]).toMatchObject({ lineWidth: 1, lineStyle: 2 });
  const first = mockCandle.createPriceLine.mock.results[0].value;

  rerender(ui([L({ title: 'Long +1.2%' }), L({ id: 'b', kind: 'liq', style: 'dashed' })]));
  expect(mockCandle.createPriceLine).toHaveBeenCalledTimes(2);
  expect(first.applyOptions).toHaveBeenCalledTimes(1);
  expect(first.applyOptions.mock.calls[0][0].title).toBe('Long +1.2%');

  rerender(ui([L({ title: 'Long +1.2%' })]));
  expect(mockCandle.removePriceLine).toHaveBeenCalledTimes(1);
  expect(first.applyOptions).toHaveBeenCalledTimes(1);
});

test('works without lines prop', () => {
  render(ui(undefined));
  expect(mockCandle.createPriceLine).not.toHaveBeenCalled();
});
