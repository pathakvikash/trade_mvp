import React from 'react';
import usePolling from '../../lib/usePolling';
import useUserStore from '../../store/userStore';
import { API } from '../../lib/api';
import Panel from '../ui/Panel';
import { LoadingBlock } from '../ui/Skeleton';
import { usd, sUsd, num } from './shared';

const POLL_MS = 15000;
// Shown when the API is unreachable so the three disclosures are never absent; same text as the server's.
export const FALLBACK_DISCLOSURES = [
  'Paper money only. Fills are simulated at the mark price with no spread or depth, so real fills would be worse.',
  'Funding is not charged. Real perpetual positions pay or receive funding, so real results would differ.',
  'Past and paper results do not predict future results. Not financial advice.',
];

const Stat = ({ label, value, note }) => (
  <div className="min-w-0"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="break-words text-sm text-slate-100">{value}</dd>{note && <dd className="text-[11px] text-slate-500">{note}</dd>}</div>
);

export const Disclosures = ({ items }) => (
  <ul aria-label="Disclosures" className="list-disc space-y-0.5 pl-4 text-xs text-slate-400">
    {(Array.isArray(items) && items.length ? items : FALLBACK_DISCLOSURES).map((d, i) => <li key={i}>{String(d)}</li>)}
  </ul>
);

export const PerformanceBody = ({ p }) => {
  const { pnl = {}, benchmark, trades = {}, evidence = {}, drift = {} } = p;
  const iv = evidence.ci95Pct;
  const share = pnl.feesShareOfGross;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Net P&L (after fees)" value={pnl.netCents == null ? 'Unavailable (no fresh mark)' : sUsd(pnl.netCents)} note={pnl.unrealizedCents != null ? `realized ${sUsd(pnl.realizedNetCents)}, open ${sUsd(pnl.unrealizedCents)}` : null} />
        <Stat label="vs buy-and-hold" value={p.vsBenchmarkCents == null ? 'Unavailable' : sUsd(p.vsBenchmarkCents)} note={benchmark ? `buy-and-hold net ${sUsd(benchmark.netCents)} on ${usd(benchmark.notionalCents)}, after fees` : 'needs the start price and a fresh mark'} />
        <Stat label="Fees" value={usd(pnl.feesCents)} note={share == null ? 'share of gross: not defined when gross is not positive' : `${num(share * 100, 1)}% of gross profit`} />
        <Stat label="Trades" value={`${num(trades.n, 0)} closed${trades.open ? ', 1 open' : ''}`} note={`wins ${num(trades.wins, 0)} / losses ${num(trades.losses, 0)}; max drawdown ${usd(trades.maxDrawdownCents)}`} />
      </dl>
      <div className="rounded-md border border-slate-800 p-2 text-xs" aria-label="Evidence">
        {evidence.label && <p className="font-semibold text-amber-300">{String(evidence.label)}</p>}
        <p className="text-slate-300">
          {num(evidence.n, 0)} closed trades.
          {iv ? ` 95% interval of the mean net return per trade: ${num(iv.low, 2)}% to ${num(iv.high, 2)}% (mean ${num(evidence.meanReturnPct, 2)}%).` : ' Not enough trades for a 95% interval.'}
        </p>
        {evidence.note && <p className="font-semibold text-slate-200">{String(evidence.note)}</p>}
        {evidence.basis && <p className="text-slate-500">{String(evidence.basis)}</p>}
      </div>
      <div className="text-xs text-slate-400" aria-label="Drift">
        <h4 className="font-medium text-slate-300">Drift versus the backtest</h4>
        <p>Missed bars {num(drift.missed, 0)}, skipped {num(drift.skipped, 0)}{drift.skipReasons && Object.keys(drift.skipReasons).length ? ` (${Object.entries(drift.skipReasons).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}.</p>
        {!drift.available && <p>Backtest comparison unavailable (no candles).</p>}
        {drift.entryFill && <p>Entry fills: {num(drift.entryFill.n, 0)} compared{drift.entryFill.meanAdverseBps != null ? `, mean ${num(drift.entryFill.meanAdverseBps, 1)} bps` : ''}. {String(drift.entryFill.note || '')}</p>}
        {drift.sameWindow && <p>Same window: backtest {num(drift.sameWindow.backtestTrades, 0)} trades, {num(drift.sameWindow.backtestReturnPct, 2)}%; live {num(drift.sameWindow.liveTrades, 0)} trades, {num(drift.sameWindow.liveReturnPct, 2)}%. {String(drift.sameWindow.note || '')}</p>}
      </div>
    </div>
  );
};

const BotPerformance = ({ botId }) => {
  const token = useUserStore((st) => st.token);
  const { data, error, loading } = usePolling(`${API}/api/bots/${botId}/performance`, POLL_MS, undefined, token);
  return (
    <Panel title="Performance (forward, paper money)">
      {loading && <LoadingBlock height={90} label="Loading performance" />}
      {error && !data && <p role="alert" className="mb-2 text-xs text-rose-400">Performance unavailable, retrying.</p>}
      {data && <PerformanceBody p={data} />}
      <div className="mt-3"><Disclosures items={data?.disclosures} /></div>
    </Panel>
  );
};

export default BotPerformance;
