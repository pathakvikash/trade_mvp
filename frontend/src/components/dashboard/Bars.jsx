import React from 'react';

// Stacked horizontal bar: each segment's width is its share of the segment total. Empty track when there is nothing to show.
export const SplitBar = ({ segments, label, className = 'h-1.5' }) => {
  const parts = segments.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div role="img" aria-label={label} className={`flex w-full overflow-hidden rounded-full bg-slate-800/70 ${className}`}>
      {parts.map((p, i) => (
        <div key={i} className={`h-full ${p.cls}`} style={{ width: `${(p.value / total) * 100}%` }} />
      ))}
    </div>
  );
};

// Small 0..1 bar for list rows.
export const MiniBar = ({ pct, cls }) => {
  const w = Math.min(100, Math.max(0, (Number.isFinite(pct) ? pct : 0) * 100));
  return (
    <div className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-slate-800/70" aria-hidden="true">
      <div className={`h-full ${cls}`} style={{ width: `${w}%` }} />
    </div>
  );
};
