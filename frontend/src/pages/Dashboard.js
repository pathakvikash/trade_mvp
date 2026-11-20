import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../components/ui/Panel';
import CopilotPanel from '../components/ai/CopilotPanel';
import usePolling from '../lib/usePolling';
import { FUT, coin, fmtPct, fmtPrice, fmtTime, fmtUsd } from '../components/liquidation/shared';
import { fundingExtremes, topMovers, totalOi, weightedFunding } from '../components/dashboard/stats';

const up = (v) => (v >= 0 ? 'text-emerald-400' : 'text-rose-400');
const fpct = (f) => (Number.isFinite(f) ? `${f >= 0 ? '+' : ''}${(f * 100).toFixed(4)}%` : '--');

const Stat = ({ label, children, sub }) => (
  <div className="rounded-lg border border-slate-800/80 p-3">
    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-200">{children}</p>
    {sub && <p className="text-xs tabular-nums text-slate-400">{sub}</p>}
  </div>
);

const List = ({ title, rows, value, cls }) => (
  <Panel title={title}>
    {rows.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">No data yet.</p> : (
      <ul className="space-y-1 text-sm tabular-nums">
        {rows.map((r) => (
          <li key={r.symbol} className="flex justify-between">
            <Link to={`/trade?symbol=${coin(r.symbol)}`} className="focus-ring rounded text-slate-200 hover:text-cyan-400">{coin(r.symbol)}</Link>
            <span className={cls(r)}>{value(r)}</span>
          </li>
        ))}
      </ul>
    )}
  </Panel>
);

const Dashboard = () => {
  const ov = usePolling(`${FUT}/overview`, 30000);
  const liq = usePolling(`${FUT}/liquidations`, 30000);
  const rows = useMemo(() => (Array.isArray(ov.data) ? ov.data : []), [ov.data]);
  const bySym = (s) => rows.find((r) => r.symbol === s);
  const { gainers, losers } = useMemo(() => topMovers(rows), [rows]);
  const { high, low } = useMemo(() => fundingExtremes(rows), [rows]);
  const avgFunding = useMemo(() => weightedFunding(rows), [rows]);
  const oi = useMemo(() => totalOi(rows), [rows]);
  const oiRows = rows.filter((r) => Number.isFinite(r.openInterestUsd)).length;
  const big = useMemo(() => [...(liq.data?.recent || [])].sort((a, b) => b.usd - a.usd).slice(0, 5), [liq.data]);
  const w = (k) => liq.data?.windows?.[k];
  const split = (x) => (x ? `L ${fmtUsd(x.longUsd)} / S ${fmtUsd(x.shortUsd)}` : '');

  return (
    <div className="space-y-3">
      {ov.error && !rows.length && <p className="text-sm text-amber-400" role="alert">Market data unavailable, retrying.</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {['BTCUSDT', 'ETHUSDT'].map((s) => {
          const r = bySym(s);
          return <Stat key={s} label={coin(s)} sub={r ? <span className={up(r.priceChangePercent)}>{fmtPct(r.priceChangePercent)} 24h</span> : null}>{r ? fmtPrice(r.lastPrice) : '--'}</Stat>;
        })}
        <Stat label={`Open interest (top ${oiRows} perps)`}>{oiRows ? fmtUsd(oi) : '--'}</Stat>
        <Stat label="Avg funding (vol-weighted)">{fpct(avgFunding)}</Stat>
        <Stat label="Liquidations 1h (sampled)" sub={split(w('1h'))}>{w('1h') ? fmtUsd(w('1h').longUsd + w('1h').shortUsd) : '--'}</Stat>
        <Stat label="Liquidations 24h (sampled)" sub={split(w('24h'))}>{w('24h') ? fmtUsd(w('24h').longUsd + w('24h').shortUsd) : '--'}</Stat>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <List title="Top gainers" rows={gainers} value={(r) => fmtPct(r.priceChangePercent)} cls={() => 'text-emerald-400'} />
            <List title="Top losers" rows={losers} value={(r) => fmtPct(r.priceChangePercent)} cls={() => 'text-rose-400'} />
            <List title="Highest funding" rows={high} value={(r) => fpct(r.fundingRate)} cls={(r) => up(r.fundingRate)} />
            <List title="Lowest funding" rows={low} value={(r) => fpct(r.fundingRate)} cls={(r) => up(r.fundingRate)} />
          </div>
          <Panel title="Largest recent liquidations (sampled)">
            {big.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">{liq.error ? 'Liquidation feed unavailable, retrying.' : 'Waiting for liquidations...'}</p> : (
              <ul className="space-y-1 text-sm tabular-nums">
                {big.map((e) => (
                  <li key={`${e.symbol}${e.ts}${e.price}${e.qty}`} className="flex justify-between gap-2">
                    <span className="text-slate-200">{coin(e.symbol)} <span className={e.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}>{e.side === 'long' ? 'long liq' : 'short liq'}</span></span>
                    <span className="text-slate-400">{fmtTime(e.ts)} · <span className="text-amber-400">{fmtUsd(e.usd)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <div className="flex flex-wrap gap-2">
            {[['/trade', 'Trade'], ['/derivatives', 'Derivatives'], ['/liquidation', 'Liquidations']].map(([to, l]) => (
              <Link key={to} to={to} className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-900">{l}</Link>
            ))}
          </div>
        </div>
        <CopilotPanel symbol="BTCUSDT" />
      </div>
    </div>
  );
};

export default Dashboard;
