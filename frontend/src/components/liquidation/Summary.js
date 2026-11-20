import React from 'react';
import { Notice, Panel, fmtTime, fmtUsd } from './shared';

const Bar = ({ longUsd, shortUsd }) => {
  const t = longUsd + shortUsd;
  const lp = t ? (longUsd / t) * 100 : 50;
  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`Longs ${lp.toFixed(0)} percent, shorts ${(100 - lp).toFixed(0)} percent`}>
      {t > 0 && <><div className="bg-emerald-400" style={{ width: `${lp}%` }} /><div className="bg-rose-400" style={{ width: `${100 - lp}%` }} /></>}
    </div>
  );
};

const Summary = ({ data, error }) => (
  <Panel title="Rekt summary (sampled)" right={data?.since ? <span className="text-[11px] text-slate-500">history since {fmtTime(data.since)}</span> : null}>
    {!data ? <Notice tone={error ? 'error' : 'muted'}>{error ? 'Liquidation feed unavailable, retrying.' : 'Loading...'}</Notice> : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {['1h', '4h', '24h'].map((k) => {
          const w = data.windows?.[k] || { longUsd: 0, shortUsd: 0, count: 0 };
          return (
            <div key={k} className="rounded-lg border border-slate-800/80 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-slate-400">{k}</span>
                <span className="text-lg font-semibold tabular-nums text-slate-200">{fmtUsd(w.longUsd + w.shortUsd)}</span>
              </div>
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
    )}
  </Panel>
);

export default Summary;
