import React from 'react';
import { Notice, Panel, StaleNote, fmtTime, fmtUsd } from './shared';
import Skeleton from '../ui/Skeleton';
import StatPopover from './StatPopover';

const Bar = ({ longUsd, shortUsd }) => {
  const t = longUsd + shortUsd;
  const lp = t ? (longUsd / t) * 100 : 50;
  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`Longs ${lp.toFixed(0)} percent, shorts ${(100 - lp).toFixed(0)} percent`}>
      {t > 0 && <><div className="bg-emerald-400" style={{ width: `${lp}%` }} /><div className="bg-rose-400" style={{ width: `${100 - lp}%` }} /></>}
    </div>
  );
};

const pct = (a, t) => (t ? Math.round((a / t) * 100) : 0);

const RektDetails = ({ k, w }) => {
  const t = w.longUsd + w.shortUsd;
  return (
    <div className="space-y-1.5 tabular-nums">
      <p className="font-medium text-slate-100">Last {k}: {fmtUsd(t)} liquidated</p>
      <Bar longUsd={w.longUsd} shortUsd={w.shortUsd} />
      <p><span className="text-emerald-400">Longs {fmtUsd(w.longUsd)} ({pct(w.longUsd, t)}%)</span></p>
      <p><span className="text-rose-400">Shorts {fmtUsd(w.shortUsd)} ({pct(w.shortUsd, t)}%)</span></p>
      <p>{w.count} events in the window.</p>
      <p className="text-[11px] text-slate-400">Sampled: Binance publishes at most one liquidation per symbol per second, so real totals are higher.</p>
    </div>
  );
};

const Summary = ({ data, error }) => (
  <Panel title="Rekt summary (sampled)" right={data?.since ? <span className="text-[11px] text-slate-500">history since {fmtTime(data.since)}</span> : null}>
    {!data && error ? <Notice tone="error">Liquidation feed unavailable, retrying.</Notice> : !data ? (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-lg border border-slate-800/80 p-3">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="mt-3 h-5 w-24" />
            <Skeleton className="mt-3 h-2 w-full" />
          </div>
        ))}
      </div>
    ) : (
      <>
      {error && <StaleNote />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {['1h', '4h', '24h'].map((k) => {
          const w = data.windows?.[k] || { longUsd: 0, shortUsd: 0, count: 0 };
          return (
            <div key={k} className="rounded-lg border border-slate-800/80 p-3">
              <StatPopover
                label={`${k} liquidation details`}
                tip={`Last ${k}, sampled. Click for details`}
                className="focus-ring flex w-full items-baseline justify-between rounded text-left hover:bg-slate-900"
                trigger={<><span className="text-xs text-slate-400">{k}</span><span className="text-lg font-semibold tabular-nums text-slate-200">{fmtUsd(w.longUsd + w.shortUsd)}</span></>}
              >
                <RektDetails k={k} w={w} />
              </StatPopover>
              <Bar longUsd={w.longUsd} shortUsd={w.shortUsd} />
              <div className="mt-1.5 flex justify-between text-xs tabular-nums">
                <span className="text-emerald-400">Long {fmtUsd(w.longUsd)}</span>
                <span className="text-slate-500">{w.count} events</span>
                <span className="text-rose-400">Short {fmtUsd(w.shortUsd)}</span>
              </div>
            </div>
          );
        })}
      </div>
      </>
    )}
  </Panel>
);

export default Summary;
