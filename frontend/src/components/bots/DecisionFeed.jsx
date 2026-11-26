import React from 'react';
import usePolling from '../../lib/usePolling';
import useUserStore from '../../store/userStore';
import { API } from '../../lib/api';
import { fmtTime } from '../ui/fmt';
import { RowBoundary, usd } from './shared';

const POLL_MS = 5000;
const s = (v) => (v === null || v === undefined ? '--' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// Reasons are built in code on the server ({signal, conds, guard, detail}); shown as-is, as plain text.
const Reason = ({ reason }) => {
  if (reason === null || reason === undefined) return null;
  if (typeof reason !== 'object') return <p className="break-words text-slate-300">{String(reason)}</p>;
  const conds = Array.isArray(reason.conds) ? reason.conds : [];
  return (
    <div className="space-y-0.5 text-slate-300">
      {reason.signal != null && <p>signal: {s(reason.signal)}</p>}
      {conds.map((c, i) => <p key={i} className="break-words">{s(c?.text)}: {s(c?.left)} vs {s(c?.right)} ({c?.ok ? 'met' : 'not met'})</p>)}
      {reason.guard != null && <p className="text-amber-300">guard: {s(reason.guard)}</p>}
      {reason.detail != null && <p className="break-words">{s(reason.detail)}{reason.by ? ` (by ${s(reason.by)})` : ''}</p>}
    </div>
  );
};

const Row = ({ d }) => (
  <li className="border-t border-slate-800/60 py-2 text-xs">
    <div className="flex flex-wrap items-baseline gap-x-2 text-slate-400">
      <time dateTime={String(d.at)}>{fmtTime(d.at)}</time>
      <span className="uppercase tracking-wide text-slate-500">{s(d.kind)}</span>
      {d.action && <span className="font-medium text-slate-100">{s(d.action)}</span>}
      {d.status && d.status !== 'done' && <span className="text-amber-300">{s(d.status)}</span>}
      {d.fillPrice != null && <span>fill {s(d.fillPrice)}</span>}
      {d.feeCents != null && <span>fee {usd(d.feeCents)}</span>}
      {d.pnlCents != null && <span>pnl {usd(d.pnlCents)}</span>}
    </div>
    <Reason reason={d.reason} />
  </li>
);

const DecisionFeed = ({ botId }) => {
  const token = useUserStore((st) => st.token);
  const { data, error, loading } = usePolling(`${API}/api/bots/${botId}/decisions?limit=50`, POLL_MS, undefined, token);
  const rows = Array.isArray(data) ? data : [];
  return (
    <div aria-label="Decisions feed" aria-live="polite">
      {loading && <p role="status" className="text-xs text-slate-500">Loading decisions</p>}
      {error && !data && <p role="alert" className="text-xs text-rose-400">Decisions unavailable, retrying.</p>}
      {!loading && !error && !rows.length && <p className="text-xs text-slate-500">No decisions yet. A running bot logs one per candle.</p>}
      <ul className="max-h-96 overflow-y-auto">
        {rows.map((d, i) => <RowBoundary key={d?._id || i} label="This decision"><Row d={d} /></RowBoundary>)}
      </ul>
    </div>
  );
};

export default DecisionFeed;
