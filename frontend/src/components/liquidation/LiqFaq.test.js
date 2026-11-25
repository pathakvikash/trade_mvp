import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LiqFaq, { LIQ_FAQ } from './LiqFaq';

global.IS_REACT_ACT_ENVIRONMENT = true;

test('eight questions rendered as details/summary', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<LiqFaq />));
  expect(LIQ_FAQ).toHaveLength(8);
  expect(container.querySelectorAll('details')).toHaveLength(8);
  expect(container.querySelectorAll('summary')).toHaveLength(8);
  act(() => root.unmount());
});

test('polling and failure wording matches the page: feed 5 s, overview 60 s, last good data kept with a refresh-failed note', () => {
  const text = LIQ_FAQ.map(([, a]) => a).join(' ');
  expect(text).toContain('feed and the rekt summary poll about every 5 seconds');
  expect(text).toContain('about every 60 seconds');
  expect(text).toContain('refresh failed');
  expect(text).not.toContain('instead of showing old numbers');
});

test('source answer matches the docs: heatmap and map rebuilt from Bybit or Gate, never "no alternative source"', () => {
  const text = LIQ_FAQ.map(([, a]) => a).join(' ');
  expect(text).toContain('rebuilt from Bybit or Gate candles and open interest');
  expect(text).not.toContain('no alternative source');
});
