import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import Skeleton from '../ui/Skeleton';
import AgentLauncher from '../ai/AgentLauncher';
import NewsFeed from '../news/NewsFeed';
import { Icon } from '../shell/nav';
import { msToNextFunding } from '../shell/TickerBar';
import { SplitBar } from './Bars';
import { fmtFunding, toneCls } from './format';
import { coin, fmtTime, fmtUsd } from '../liquidation/shared';
import { fmtCountdown } from '../ui/fmt';
import { asOf, pct, price } from '../../lib/instrumentFormat';
import { derivativesPulse, liqView, pickInstruments } from '../../lib/dashboardStats';

const linkCls = 'focus-ring rounded font-medium text-cyan-400 hover:text-cyan-300';
const link = (to, text) => <Link to={to} className={`${linkCls} inline-flex text-xs max-sm:min-h-9 max-sm:items-center`}>{text}</Link>;
const Empty = ({ children }) => <div className="py-4 text-center text-sm text-slate-400">{children}</div>;
const Note = ({ children }) => <p className="mt-2 text-[11px] leading-snug text-slate-500">{children}</p>;
const Rows = ({ n }) => (
  <ul className="space-y-2.5" aria-hidden="true">
    {Array.from({ length: n }, (_, i) => <li key={i} className="flex justify-between gap-3"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 w-20" /></li>)}
  </ul>
);
const cardCls = 'min-h-[260px]';
const UP = 'bg-emerald-400/70';
const DOWN = 'bg-rose-400/70';

// A failing widget must never take the page down.
export class CardBoundary extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* nothing to report: the fallback below is the message */ }
  render() { return this.state.failed ? <Empty>This card could not be shown.</Empty> : this.props.children; }
}

export const NewsCard = () => (
  <Panel title="Market news" className={`${cardCls} min-h-[320px]`}>
    <CardBoundary><NewsFeed compact limit={6} category="all" /></CardBoundary>
  </Panel>
);

// res: usePolling result for /instruments/quotes (all categories).
export const RealMarketsCard = ({ res }) => {
  const rows = Array.isArray(res.data?.rows) ? pickInstruments(res.data.rows) : null;
  let body;
  if (res.loading && !rows) body = <Rows n={6} />;
  else if (!rows) body = <Empty>Real-market quotes unavailable, retrying.</Empty>;
  else if (!rows.length) body = <Empty>No quotes returned.</Empty>;
  else {
    body = (
      <ul className="divide-y divide-slate-800/60 text-sm tabular-nums">
        {rows.map((r) => (
          <li key={r.symbol} className="flex items-center justify-between gap-2 py-1.5">
            <span className="min-w-0 truncate text-slate-200" title={r.name}>{r.symbol}</span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-slate-300">{price(r, r.price)}</span>
              <span className={`w-16 text-right ${toneCls(r.changePct)}`}>{pct(r.changePct)}</span>
              <span className={`w-12 text-center text-[10px] uppercase ${r.marketOpen ? 'text-emerald-300' : 'text-slate-500'}`}>
                {r.marketOpen === true ? 'Open' : r.marketOpen === false ? 'Closed' : 'n/a'}
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  const latest = rows?.length ? Math.max(...rows.map((r) => r.asOf).filter(Number.isFinite)) : NaN;
  return (
    <Panel title="Real markets" right={<span className="flex gap-3">{link('/stocks', 'Stocks →')}{link('/derivatives?category=index&instrument=NIFTY50', 'More →')}</span>} className={cardCls} bodyClassName="min-h-0 p-3">
      {body}
      <Note>Delayed, unofficial Yahoo Finance data, view only{Number.isFinite(latest) ? `, latest quote ${asOf(latest)}` : ''}. Gold and crude are futures prices.</Note>
    </Panel>
  );
};

const FundList = ({ list, label }) => (
  <div className="min-w-0 flex-1">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    {list.length ? list.map((r) => (
      <Link key={r.symbol} to={`/trade?symbol=${coin(r.symbol)}`} className="focus-ring flex justify-between gap-2 rounded py-0.5 text-sm tabular-nums hover:bg-slate-900/60">
        <span className="text-slate-200">{coin(r.symbol)}</span><span className={toneCls(r.fundingRate)}>{fmtFunding(r.fundingRate)}</span>
      </Link>
    )) : <div className="py-0.5 text-sm text-slate-500">--</div>}
  </div>
);

export const DerivativesPulseCard = ({ rows, loading, failed }) => {
  const p = derivativesPulse(rows, 40);
  let body;
  if (loading && !p.count) body = <Rows n={6} />;
  else if (!p.count) body = <Empty>{failed ? 'Market data unavailable, retrying.' : 'No data yet.'}</Empty>;
  else {
    body = (
      <div className="space-y-3 text-sm tabular-nums">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Open interest · top {p.count} perps</div>
            <div className="text-lg font-semibold text-slate-100">{p.oiUsd === null ? '--' : fmtUsd(p.oiUsd)}</div>
            {p.oiMissing > 0 && <div className="text-[11px] text-slate-500">{p.oiMissing} without OI data, excluded</div>}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Funding · volume-weighted</div>
            <div className={`text-lg font-semibold ${toneCls(p.funding)}`}>{fmtFunding(p.funding)}</div>
            <div className="text-[11px] text-slate-500">{p.hot} above +0.03% · {p.cold} below -0.03%</div>
          </div>
        </div>
        <div className="flex gap-4"><FundList list={p.mostPositive} label="Highest funding" /><FundList list={p.mostNegative} label="Lowest funding" /></div>
        <div>
          <div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>{p.up} up</span><span>24h breadth, {p.moveCount} perps</span><span>{p.down} down</span></div>
          <SplitBar label={`${p.up} perps up and ${p.down} down in 24 hours`} segments={[{ value: p.up, cls: UP }, { value: p.down, cls: DOWN }]} />
        </div>
      </div>
    );
  }
  return (
    <Panel title="Derivatives pulse" right={link('/derivatives', 'Derivatives →')} className={cardCls} bodyClassName="min-h-0 p-3">
      {body}
      <Note>Live Binance USDS-M data for the top 40 perps by volume only, not the whole market. 8h funding rates.</Note>
    </Panel>
  );
};

const LiqRow = ({ k, w }) => (
  <div>
    <div className="flex justify-between text-sm tabular-nums">
      <span className="text-slate-400">{k} <span className="text-slate-100">{w ? fmtUsd(w.total) : '--'}</span></span>
      <span className="text-xs"><span className="text-emerald-400">long {w ? fmtUsd(w.long) : '--'}</span> · <span className="text-rose-400">short {w ? fmtUsd(w.short) : '--'}</span></span>
    </div>
    <div className="mt-1"><SplitBar label={`${k} long against short liquidations`} segments={w ? [{ value: w.long, cls: UP }, { value: w.short, cls: DOWN }] : []} /></div>
  </div>
);

export const LiquidationsSampledCard = ({ data, loading, failed }) => {
  const v = liqView(data, 5);
  let body;
  if (loading && !data) body = <Rows n={6} />;
  else if (!v.h1 && !v.h24) body = <Empty>{failed ? 'Liquidation data unavailable, retrying.' : 'Waiting for liquidations...'}</Empty>;
  else {
    body = (
      <div className="space-y-3">
        <LiqRow k="1h" w={v.h1} />
        <LiqRow k="24h" w={v.h24} />
        <ul className="divide-y divide-slate-800/60 text-sm tabular-nums">
          {v.biggest.map((e) => (
            <li key={`${e.symbol}${e.ts}${e.price}${e.qty}`} className="flex justify-between gap-2 py-1">
              <span className="text-slate-200">{coin(e.symbol)} <span className={e.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}>{e.side === 'long' ? 'long' : 'short'}</span></span>
              <span className="text-slate-400">{fmtTime(e.ts)} · <span className="text-amber-400">{fmtUsd(e.usd)}</span></span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <Panel title="Liquidations (sampled)" right={link('/liquidation', 'Liquidations →')} className={cardCls} bodyClassName="min-h-0 p-3">
      {body}
      <Note>Sampled from the exchange stream since this server started; real totals are higher.</Note>
    </Panel>
  );
};

const tz = (zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const UTC = tz('UTC');
const IST = tz('Asia/Kolkata');

// quotes: usePolling result for /instruments/quotes (NSE state comes from NIFTY50 marketOpen).
export const MarketClock = ({ quotes }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);
  const nifty = Array.isArray(quotes.data?.rows) ? quotes.data.rows.find((r) => r.symbol === 'NIFTY50') : null;
  const nse = !nifty || nifty.marketOpen == null ? 'n/a' : nifty.marketOpen ? 'Open' : 'Closed';
  const d = new Date(now);
  const item = (label, value, cls = 'text-slate-100') => (
    <div className="min-w-[5.5rem]"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className={`text-sm font-semibold tabular-nums ${cls}`}>{value}</div></div>
  );
  return (
    <section aria-label="Market clock" className="flex min-h-[52px] flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2">
      {item('UTC', UTC.format(d))}
      {item('IST', IST.format(d))}
      {item('Next funding', fmtCountdown(msToNextFunding(now)))}
      {item('NSE', nse, nse === 'Open' ? 'text-emerald-300' : 'text-slate-300')}
      <div className="text-[11px] text-slate-500">Funding every 8h (00/08/16 UTC), most perps. India quotes are delayed{nifty?.stale ? ' (stale now)' : ''}.</div>
    </section>
  );
};

const btn = 'focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-cyan-500/40 hover:bg-slate-900/60 max-sm:min-h-9';
const ACTIONS = [
  { to: '/trade?symbol=BTC', label: 'Open Trade (BTC)', d: 'M7 20V4M7 4L3 8M7 4l4 4M17 4v16M17 20l-4-4M17 20l4-4' },
  { to: '/trade?alerts=1', label: 'Set an alert', d: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4' },
  { to: '/docs', label: 'View Docs', d: 'M6 4h9l3 3v13H6zM9 10h6M9 14h6M9 18h4' },
];
export const QuickActions = () => (
  <nav aria-label="Quick actions" className="flex flex-wrap items-center gap-2">
    {ACTIONS.map((a) => <Link key={a.to} to={a.to} className={btn}><Icon d={a.d} className="h-3.5 w-3.5" />{a.label}</Link>)}
    <AgentLauncher kind="perp" symbol="BTCUSDT" page="dashboard" label="Ask AI" className="max-sm:min-h-9 py-1.5" />
  </nav>
);
