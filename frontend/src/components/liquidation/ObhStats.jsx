import React from 'react';
import { statCards } from './obh';
import { coin } from './shared';

// Six cards under the header: price, both depths, imbalance and the largest wall each side. Wraps 2 / 3 / 6 per row.
const ObhStats = ({ data, symbol }) => (
  <dl aria-label="Order book summary" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
    {statCards(data, coin(symbol)).map((c) => (
      <div key={c.id} data-testid={`stat-${c.id}`} className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
        <dt className="truncate text-[11px] uppercase tracking-wider text-slate-500" title={c.label}>{c.label}</dt>
        <dd className={`mt-0.5 truncate text-lg font-semibold tabular-nums ${c.tone}`}>{c.value}</dd>
        <dd className="truncate text-xs tabular-nums text-slate-300">{c.sub}</dd>
        {c.foot && <dd className="truncate text-[11px] tabular-nums text-slate-500" title={c.foot}>{c.foot}</dd>}
      </div>
    ))}
  </dl>
);

export default ObhStats;
