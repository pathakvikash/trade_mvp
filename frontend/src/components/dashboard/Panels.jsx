import usePersistedState from '../../lib/usePersistedState';
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import Skeleton from '../ui/Skeleton';
import { MiniBar } from './Bars';
import { fmtFunding, toneCls } from './format';
import { moverList } from './stats';
import { coin, fmtPct, fmtMarketPrice, fmtTime, fmtUsd } from '../liquidation/shared';
import { fmtQty } from '../ui/fmt';
import { describeAlert } from '../alerts/alertLogic';

const linkCls = 'focus-ring rounded font-medium text-cyan-400 hover:text-cyan-300';
const ViewAll = ({ to }) => <Link to={to} className={`${linkCls} inline-flex text-xs max-sm:min-h-9 max-sm:items-center`}>View all →</Link>;
const Empty = ({ children }) => <div className="py-4 text-center text-sm text-slate-400">{children}</div>;

const RowsSkeleton = ({ rows = 5 }) => (
  <ul className="space-y-2.5" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <li key={i} className="flex justify-between gap-3"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 w-20" /></li>
    ))}
  </ul>
);

// Panels fill their grid cell on xl and scroll inside the body; below xl they size to content.
const panelCls = 'xl:min-h-0 xl:overflow-hidden';
const bodyCls = 'min-h-0 p-3 xl:overflow-auto';

const TABS = [['gainers', 'Gainers'], ['losers', 'Losers'], ['volume', 'Volume'], ['funding', 'Funding']];
const metricOf = (tab, r) => (tab === 'volume' ? r.quoteVolume : tab === 'funding' ? r.fundingRate : r.priceChangePercent);
const textOf = (tab, r) => (tab === 'volume' ? fmtUsd(r.quoteVolume) : tab === 'funding' ? fmtFunding(r.fundingRate) : fmtPct(r.priceChangePercent));
const toneOf = (tab, r) => (tab === 'volume' ? 'text-slate-200' : toneCls(metricOf(tab, r)));
const barOf = (tab, r) => (tab === 'volume' ? 'bg-cyan-400/60' : metricOf(tab, r) >= 0 ? 'bg-emerald-400/70' : 'bg-rose-400/70');

export const MoversPanel = ({ rows, loading, failed }) => {
  const [tab, setTab] = usePersistedState('dashboard.moversTab', 'gainers', { validate: (v) => TABS.some(([id]) => id === v) });
  const list = useMemo(() => moverList(rows, tab, 8), [rows, tab]);
  const max = Math.max(0, ...list.map((r) => Math.abs(metricOf(tab, r)) || 0));
  let body;
  if (loading) body = <RowsSkeleton rows={8} />;
  else if (failed && !rows.length) body = <Empty>Market data unavailable, retrying.</Empty>;
  else if (!list.length) body = <Empty>No data yet.</Empty>;
  else {
    body = (
      <ul className="divide-y divide-slate-800/60">
        {list.map((r) => (
          <li key={r.symbol}>
            <Link to={`/trade?symbol=${coin(r.symbol)}`} className="focus-ring flex items-center gap-3 rounded px-1 py-1.5 text-sm tabular-nums hover:bg-slate-900/60">
              <span className="w-14 font-medium text-slate-200">{coin(r.symbol)}</span>
              <span className="flex-1 text-right text-slate-400">{fmtMarketPrice(r.lastPrice)}</span>
              <span className={`w-20 text-right ${toneOf(tab, r)}`}>{textOf(tab, r)}</span>
              <MiniBar pct={max ? Math.abs(metricOf(tab, r)) / max : 0} cls={barOf(tab, r)} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Panel title="Market movers" right={<ViewAll to="/market" />} className={`xl:row-span-2 ${panelCls}`} bodyClassName={bodyCls}>
      <div role="tablist" aria-label="Market movers" className="mb-2 flex flex-wrap gap-1">
        {TABS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`focus-ring rounded-md px-2 py-1 text-xs font-medium ${tab === k ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {l}
          </button>
        ))}
      </div>
      {body}
    </Panel>
  );
};

export const LiquidationsPanel = ({ recent, loading, failed }) => {
  const big = useMemo(() => [...(recent || [])].sort((a, b) => b.usd - a.usd).slice(0, 8), [recent]);
  let body;
  if (!big.length && loading) body = <RowsSkeleton rows={6} />;
  else if (!big.length) body = <Empty>{failed ? 'Liquidation feed unavailable, retrying.' : 'Waiting for liquidations...'}</Empty>;
  else {
    body = (
      <ul className="divide-y divide-slate-800/60 text-sm tabular-nums">
        {big.map((e) => (
          <li key={`${e.symbol}${e.ts}${e.price}${e.qty}`} className="flex justify-between gap-2 py-1.5">
            <span className="text-slate-200">{coin(e.symbol)} <span className={e.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}>{e.side === 'long' ? 'long liq' : 'short liq'}</span></span>
            <span className="text-slate-400">{fmtTime(e.ts)} · <span className="text-amber-400">{fmtUsd(e.usd)}</span></span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Panel title="Largest liquidations (sampled)" right={<ViewAll to="/liquidation" />} className={panelCls} bodyClassName={bodyCls}>
      {body}
    </Panel>
  );
};

// items: valueHoldings().items (value/pnl may be null while a price is missing).
export const HoldingsPanel = ({ items, loading, failed }) => {
  const top = useMemo(() => [...items].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 5), [items]);
  let body;
  if (loading) body = <RowsSkeleton rows={4} />;
  else if (failed) body = <Empty>Portfolio unavailable, retrying.</Empty>;
  else if (!top.length) {
    body = (
      <Empty>
        No holdings yet. <Link to="/trade" className={linkCls}>Make your first paper trade</Link>
      </Empty>
    );
  } else {
    body = (
      <ul className="divide-y divide-slate-800/60 text-sm tabular-nums">
        {top.map((h) => (
          <li key={h.symbol} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-slate-200">{h.symbol}<span className="ml-2 text-xs text-slate-500">{fmtQty(h.amount)}</span></span>
            <span className="text-right">
              <span className="block text-slate-200">{fmtUsd(h.value)}</span>
              <span className={`block text-xs ${toneCls(h.pnl)}`}>
                {h.pnl === null ? 'price unavailable' : `${h.pnl >= 0 ? '+' : ''}${fmtUsd(h.pnl)}${Number.isFinite(h.pnlPct) ? ` (${fmtPct(h.pnlPct)})` : ''}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Panel title="Portfolio holdings" right={<ViewAll to="/portfolio" />} className={panelCls} bodyClassName={bodyCls}>
      {body}
    </Panel>
  );
};

export const AlertTriggersPanel = ({ events, loaded, failed }) => {
  const list = events.slice(0, 6);
  let body;
  if (!loaded && !list.length) body = <RowsSkeleton rows={4} />;
  else if (!list.length && failed) body = <Empty>Alerts unavailable, retrying.</Empty>;
  else if (!list.length) body = <Empty>No triggers yet. <Link to="/trade?alerts=1" className={linkCls}>Create an alert</Link></Empty>;
  else {
    body = (
      <ul className="divide-y divide-slate-800/60 text-sm tabular-nums">
        {list.map((e, i) => (
          <li key={e._id || i} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-1.5">
            <span className="text-slate-200">{describeAlert(e)}</span>
            <span className="text-xs text-slate-400">{fmtTime(e.ts)} · observed {Number(e.observed).toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Panel title="Recent alert triggers" right={<ViewAll to="/trade?alerts=1" />} className={panelCls} bodyClassName={bodyCls}>
      {body}
    </Panel>
  );
};
