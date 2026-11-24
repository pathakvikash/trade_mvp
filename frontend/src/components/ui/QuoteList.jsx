import React from 'react';
import { pct, StatusBadges } from '../../lib/instrumentFormat';

// Phone layout (below sm) for quote tables: one tappable row per instrument, no sideways scrolling.
// `fmt(row)` returns the price text; tapping a row selects it (opens its chart).
const QuoteList = ({ rows, selected, onSelect, fmt, empty }) => (
  <ul className="divide-y divide-slate-800/60 overflow-hidden rounded-xl border border-slate-800/80 sm:hidden">
    {rows.map((r) => (
      <li key={r.symbol}>
        <button
          type="button"
          onClick={() => onSelect(r.symbol)}
          aria-label={`Open chart for ${r.symbol}`}
          className={`focus-ring flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-900/60 ${selected === r.symbol ? 'bg-slate-900/80' : ''}`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-medium text-slate-200">{r.symbol}</span>
            <span className="block truncate text-xs text-slate-500">{r.name}</span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-sm tabular-nums text-slate-200">{fmt(r)}</span>
            <span className="flex items-center gap-2">
              <span className={`text-xs tabular-nums ${r.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pct(r.changePct)}</span>
              <StatusBadges row={r} />
            </span>
          </span>
        </button>
      </li>
    ))}
    {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{empty}</li>}
  </ul>
);

export default QuoteList;
