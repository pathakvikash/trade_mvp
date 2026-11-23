import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockCandle = {};
const mockLine = [];
const mockRemoveSeries = jest.fn();
jest.mock('lightweight-charts', () => ({ LineStyle: { Solid: 0, Dashed: 2 }, createChart: jest.fn() }));

import { createChart } from 'lightweight-charts';
import CandleChart from './CandleChart';

const candles = [{ time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 }];
const L = (o) => ({ id: 'a', price: 100, title: 'Long', color: '#22d3ee', style: 'solid', kind: 'entry', ...o });
const ui = (lines) => <CandleChart candles={candles} reloadSeq={0} label="x" lines={lines} />;

beforeEach(() => {
  Object.assign(mockCandle, {
    applyOptions: jest.fn(), setData: jest.fn(), update: jest.fn(),
    createPriceLine: jest.fn(() => ({ applyOptions: jest.fn() })), removePriceLine: jest.fn(), setMarkers: jest.fn(),
  });
  mockLine.length = 0;
  createChart.mockImplementation(() => ({
    addCandlestickSeries: () => mockCandle,
    addLineSeries: () => { const l = { setData: jest.fn(), applyOptions: jest.fn() }; mockLine.push(l); return l; },
    removeSeries: mockRemoveSeries,
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

test('overlays: line series per id, updated in place, removed on clear; markers sorted and cleared', () => {
  mockRemoveSeries.mockClear();
  const ov = (v) => [{ id: 'fast', color: '#fff', data: [{ time: 1, value: v }, { time: 2, value: v }] }, { id: 'bb.upper', data: [{ time: 1, value: 3 }] }];
  const mk = [{ time: 5, kind: 'exit_long', price: 1 }, { time: 2, kind: 'entry_long', price: 1 }, { time: 3, kind: 'nope', price: 1 }];
  const node = (overlays, markers) => <CandleChart candles={candles} reloadSeq={0} label="x" overlays={overlays} markers={markers} />;
  const { rerender } = render(node(ov(1), mk));
  expect(mockLine).toHaveLength(2);
  expect(mockLine[0].setData).toHaveBeenCalledWith([{ time: 1, value: 1 }, { time: 2, value: 1 }]);
  const m = mockCandle.setMarkers.mock.calls[0][0];
  expect(m.map((x) => x.time)).toEqual([2, 5]);
  expect(m[0]).toMatchObject({ shape: 'arrowUp', position: 'belowBar' });

  rerender(node(ov(2), mk));
  expect(mockLine).toHaveLength(2); // no new series, updated in place
  expect(mockLine[0].setData).toHaveBeenCalledTimes(2);

  rerender(node([], []));
  expect(mockRemoveSeries).toHaveBeenCalledTimes(2);
  expect(mockCandle.setMarkers).toHaveBeenLastCalledWith([]);
  expect(createChart).toHaveBeenCalledTimes(1);
});
