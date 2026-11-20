import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Sparkline, { sparkPoints, sparkTrend } from './Sparkline';

test('sparkPoints needs two finite values and draws higher values higher', () => {
  expect(sparkPoints([1])).toBe('');
  expect(sparkPoints([NaN, 2])).toBe('');
  const pts = sparkPoints([1, 3, 2]).split(' ');
  expect(pts).toEqual(['0.00,26.00', '50.00,2.00', '100.00,14.00']);
  expect(sparkPoints([5, 5])).toBe('0.00,14.00 100.00,14.00');
});

test('sparkTrend compares last value with first', () => {
  expect(sparkTrend([1, 2])).toBe('up');
  expect(sparkTrend([2, 1])).toBe('down');
  expect(sparkTrend([1])).toBeNull();
});

test('Sparkline renders a green polyline for an up series and nothing for too few points', () => {
  const html = renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />);
  expect(html).toContain('<polyline');
  expect(html).toContain('text-emerald-400');
  expect(renderToStaticMarkup(<Sparkline values={[3, 2, 1]} />)).toContain('text-rose-400');
  expect(renderToStaticMarkup(<Sparkline values={[1]} />)).toBe('');
});
