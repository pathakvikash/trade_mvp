import React, { useMemo, useState } from 'react';

export const FUT = `${process.env.REACT_APP_API_URL || ''}/api/market/futures`;

export { fmtPrice, fmtPct, fmtUsd, fmtTime } from '../ui/fmt';
export { default as Panel } from '../ui/Panel';
export const coin = (symbol) => (symbol || '').replace(/USDT$/, '');

export const is404 = (e) => e?.response?.status === 404;

export const Notice = ({ children, tone = 'muted' }) => (
  <p className={`py-6 text-center text-sm ${tone === 'error' ? 'text-amber-400' : 'text-slate-400'}`}>{children}</p>
);

// Sorting for tables: cols map key -> value getter; returns sorted rows plus header props.
export function useSort(rows, getters, initialKey, initialDir = 'desc') {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });
  const sorted = useMemo(() => {
    const g = getters[sort.key];
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = g(a);
      const y = g(b);
      if (typeof x === 'string' && typeof y === 'string') return m * x.localeCompare(y);
      const nx = x === null || x === undefined || Number.isNaN(x);
      const ny = y === null || y === undefined || Number.isNaN(y);
      if (nx || ny) return nx === ny ? 0 : nx ? 1 : -1; // missing values always last
      return m * (x - y);
    });
  }, [rows, getters, sort]);
  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  return { sorted, sort, toggle };
}

export const SortTh = ({ k, sort, toggle, children, left }) => (
  <th scope="col" aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-2 py-1.5 font-medium ${left ? 'text-left' : 'text-right'}`}>
    <button type="button" onClick={() => toggle(k)} className="uppercase tracking-wider hover:text-slate-200">
      {children}{sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  </th>
);
