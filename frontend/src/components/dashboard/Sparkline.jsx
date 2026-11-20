import React from 'react';

const W = 100;
const H = 28;

// Polyline points for a series in a W x H box (higher values sit higher). Fewer than 2 finite values gives ''.
export function sparkPoints(values, w = W, h = H, pad = 2) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const span = Math.max(...v) - lo;
  return v.map((y, i) => {
    const x = (i / (v.length - 1)) * w;
    const yy = span > 0 ? pad + (1 - (y - lo) / span) * (h - 2 * pad) : h / 2;
    return `${x.toFixed(2)},${yy.toFixed(2)}`;
  }).join(' ');
}

// 'up' when the last value is at or above the first, 'down' otherwise, null without two values.
export function sparkTrend(values) {
  const v = (values || []).filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  return v[v.length - 1] >= v[0] ? 'up' : 'down';
}

// Tiny trend line: green when the series ends higher, red when lower. Renders nothing without two points.
const Sparkline = ({ values, className = 'h-7 w-full', label = 'Price trend, last 24 hours' }) => {
  const pts = sparkPoints(values);
  if (!pts) return null;
  const tone = sparkTrend(values) === 'up' ? 'text-emerald-400' : 'text-rose-400';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={`${className} ${tone}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

export default Sparkline;
