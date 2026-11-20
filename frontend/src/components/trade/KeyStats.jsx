import React from 'react';

// Label/value grid for a panel with several numbers. Two fixed columns; labels and values truncate instead of overlapping.
const KeyStats = ({ items }) => (
  <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
    {items.map(({ label, value, tone = 'text-slate-200' }) => (
      <div key={label} className="min-w-0">
        <dt className="truncate text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
        <dd className={`truncate text-xs font-medium tabular-nums ${tone}`} title={String(value)}>{value}</dd>
      </div>
    ))}
  </dl>
);

export default KeyStats;
