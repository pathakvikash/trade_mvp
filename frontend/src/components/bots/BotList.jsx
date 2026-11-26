import React from 'react';
import usePolling from '../../lib/usePolling';
import useUserStore from '../../store/userStore';
import { API } from '../../lib/api';
import { RowBoundary, StatusBadge, sUsd, dollars } from './shared';

const Row = ({ bot, selected, onSelect }) => {
  const token = useUserStore((s) => s.token);
  const live = !!bot.startedAt; // performance exists only after a first start
  const perf = usePolling(live ? `${API}/api/bots/${bot._id}/performance` : null, 15000, undefined, token).data;
  // Fixed-height lines (truncate, no wrap) so polling updates never move the rows below.
  return (
    <li>
      <button type="button" onClick={() => onSelect(bot._id)} aria-current={selected ? 'true' : undefined}
        className={`focus-ring block min-h-[44px] w-full rounded-lg border border-l-4 p-2 text-left text-sm ${selected ? 'border-cyan-400/60 border-l-cyan-400 bg-slate-800' : 'border-slate-800 border-l-transparent bg-slate-900/40 hover:bg-slate-900'}`}>
        <span className="flex items-center gap-2"><StatusBadge status={bot.status} /><span className="min-w-0 flex-1 truncate font-medium text-slate-100">{bot.name}</span></span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">{bot.symbol} · {bot.interval} · {dollars(bot.sizeUsd)} at {bot.leverage}x</span>
        <span className="block truncate text-xs text-slate-400">
          {live ? <>P&L {perf ? sUsd(perf.pnl?.netCents) : '--'} · vs buy-and-hold {perf ? sUsd(perf.vsBenchmarkCents) : '--'}{perf?.evidence?.label ? ` · ${perf.evidence.label}` : ''}</> : 'No forward results yet'}
        </span>
      </button>
    </li>
  );
};

const BotList = ({ bots, selectedId, onSelect }) => (
  <ul className="space-y-2" aria-label="Bots">
    {bots.map((b, i) => (
      <RowBoundary key={b?._id || i} label="This bot">
        <Row bot={b} selected={b?._id === selectedId} onSelect={onSelect} />
      </RowBoundary>
    ))}
  </ul>
);

export default BotList;
