import React from 'react';
import { Link } from 'react-router-dom';
import Skeleton from '../ui/Skeleton';

// A compact command-center card. The whole card is one link to its page.
// Props: to, page (names the link for screen readers), label, value, sub, visual, badge, loading, error.
const Tile = ({ to, page, label, value, sub, visual, badge, loading, error }) => (
  <Link
    to={to}
    aria-label={`Open ${page}`}
    className="focus-ring group flex h-full min-w-0 flex-col rounded-xl border border-slate-800/80 bg-slate-950/60 p-3 transition duration-200 hover:border-cyan-500/40 hover:bg-slate-900/60 hover:shadow-lg hover:shadow-black/30 motion-safe:hover:-translate-y-0.5"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="truncate text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className="flex shrink-0 items-center gap-1.5">
        {badge && <span className="rounded bg-cyan-500/15 px-1.5 py-px text-[10px] font-medium text-cyan-300">{badge}</span>}
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="h-3.5 w-3.5 text-slate-500 transition duration-200 group-hover:text-cyan-400 motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5">
          <path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
    {loading ? (
      <div className="mt-2 space-y-2" aria-hidden="true">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    ) : error ? (
      <div className="mt-2 text-xs text-amber-400">{error}</div>
    ) : (
      <>
        <div className="mt-1.5 truncate text-xl font-semibold tabular-nums text-slate-100">{value}</div>
        {sub && <div className="mt-0.5 text-xs leading-snug tabular-nums text-slate-400">{sub}</div>}
        {visual && <div className="mt-auto flex flex-col gap-1.5 pt-2">{visual}</div>}
      </>
    )}
  </Link>
);

export default Tile;
