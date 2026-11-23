import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LiqHeatmap from './LiqHeatmap';
import { BYBIT_NOTE } from './shared';

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

const text = (source) => {
  const el = document.createElement('div');
  act(() => {
    createRoot(el).render(<LiqHeatmap symbol="BTCUSDT" range="24h" onRange={() => {}} data={null} source={source} loading={false} error={null} onRefresh={() => {}} />);
  });
  return el.textContent;
};

test('heatmap panel shows the Bybit note only for a bybit source', () => {
  expect(text('bybit')).toContain(BYBIT_NOTE);
  expect(text(null)).not.toContain('Bybit');
});

test('partial responses show the short-history note; others do not', () => {
  const t = (partial) => {
    const el = document.createElement('div');
    act(() => { createRoot(el).render(<LiqHeatmap symbol="BTCUSDT" range="24h" onRange={() => {}} data={{ partial }} source="gate" loading={false} error={null} onRefresh={() => {}} />); });
    return el.textContent;
  };
  expect(t(true)).toContain('History shorter than the selected range (new listing)');
  expect(t(false)).not.toContain('History shorter');
  expect(t(false)).toContain('Estimated from Gate perpetuals data');
});
