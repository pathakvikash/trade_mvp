import React, { useMemo, useState } from 'react';
import usePolling from '../lib/usePolling';
import { API } from '../lib/apiBase';
import Panel from '../components/ui/Panel';
import SegTabs from '../components/ui/SegTabs';
import Skeleton, { LoadingBlock } from '../components/ui/Skeleton';
import { inr, asOf, volume, pct, StatusBadges } from '../lib/instrumentFormat';
import CandleChart from '../components/trade/CandleChart';
import AgentLauncher from '../components/ai/AgentLauncher';
import StrategyChip from '../components/ai/StrategyChip';
import useStrategyOverlay from '../lib/useStrategyOverlay';
import freshCandles from '../lib/freshCandles';
import useScrollIntoView from '../lib/useScrollIntoView';
import QuoteList from '../components/ui/QuoteList';

const DISCLAIMER = 'Unofficial Yahoo Finance data, may be delayed (NSE quotes can lag about 15 min), view only, not investment advice.';
const TIMEFRAMES = ['5m', '15m', '1h', '1d'].map((id) => ({ id, label: id }));
const SORTS = [{ id: 'name', label: 'Name' }, { id: 'change', label: 'Change %' }];

const StockChart = ({ row, onClose }) => {
  const [tf, setTf] = useState('1d');
  const boxRef = useScrollIntoView();
  const k = usePolling(`${API}/api/market/stocks/klines/${encodeURIComponent(row.symbol)}?interval=${tf}&limit=200`, 60000);
  // the API answers {candles, interval, ...}; a bare array is accepted too. Another timeframe's response shows the loader.
  const candles = freshCandles(k.data, row.symbol, tf);
  const ov = useStrategyOverlay({ kind: 'instrument', symbol: row.symbol, interval: tf, candles });
  let body;
  if (k.error && !candles.length) body = <div className="flex h-full items-center justify-center text-sm text-rose-300">Unable to load candles.</div>;
  else if (k.loading || !candles.length) body = <LoadingBlock height={320} label="Loading candles…" />;
  else body = <CandleChart key={`${row.symbol}-${tf}`} candles={candles} reloadSeq={0} label={`${row.symbol} ${tf} candlestick chart`} overlays={ov.overlays} markers={ov.markers} strategyChip={<StrategyChip chip={ov.chip} />} />;
  return (
    <div ref={boxRef} className="scroll-mt-3">
    <Panel
      title={`${row.symbol} · ${row.name}`}
      className="shrink-0" bodyClassName="relative h-[340px] min-h-[340px] p-1.5 pt-2"
      right={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <AgentLauncher kind="instrument" symbol={row.symbol} page="markets" interval={tf} />
            <SegTabs tabs={TIMEFRAMES} active={tf} onChange={setTf} label="Timeframe" />
          <button type="button" onClick={onClose} className="focus-ring rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Close</button>
        </div>
      }
    >
      {body}
      <p className="absolute bottom-1 right-2 hidden text-[11px] text-slate-500 sm:block">Paper trading for stocks is not available yet.</p>
    </Panel>
    </div>
  );
};

// Real NSE stocks, view only: polled quotes table and a candle panel per row. No orders (paper trading is crypto only).
const Stocks = () => {
  const [retry, setRetry] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('name');
  const [sel, setSel] = useState(null);
  const res = usePolling(`${API}/api/market/stocks/quotes`, 60000, retry, undefined, true);
  const all = Array.isArray(res.data?.rows) ? res.data.rows : null;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (all || []).filter((r) => !t || r.symbol.toLowerCase().includes(t) || (r.name || '').toLowerCase().includes(t));
    return list.sort(sort === 'change' ? (a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) : (a, b) => (a.name || a.symbol).localeCompare(b.name || b.symbol));
  }, [all, q, sort]);
  const selected = all?.find((r) => r.symbol === sel) || null;

  let body;
  if (res.error && !all) {
    body = (
      <div role="alert" className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-rose-400/30 p-8 text-sm text-rose-300">
        <span>Stock data is unavailable right now.</span>
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="focus-ring rounded-md border border-rose-300/40 px-3 py-1 text-xs hover:bg-rose-300/10">Retry</button>
      </div>
    );
  } else if (!all) {
    body = (
      <div role="status" aria-label="Loading stocks" className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  } else {
    body = (
      <>
      <QuoteList rows={rows} selected={sel} onSelect={setSel} fmt={(r) => inr(r.price)} empty="No stocks match your search." />
      <div className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-800/80 sm:block">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-slate-500">
            <tr>{['Symbol', 'Name', 'Price', 'Change %', 'Day range', 'Volume', 'Status', 'As of'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} onClick={() => setSel(r.symbol)} className={`cursor-pointer border-t border-slate-800/60 hover:bg-slate-900/60 ${sel === r.symbol ? 'bg-slate-900/80' : ''}`}>
                <td className="px-3 py-2 font-medium text-slate-200">
                  <button type="button" onClick={() => setSel(r.symbol)} aria-label={`Show chart for ${r.symbol}`} className="focus-ring rounded">{r.symbol}</button>
                </td>
                <td className="px-3 py-2 text-slate-400">{r.name}</td>
                <td className="px-3 py-2 tabular-nums text-slate-200">{inr(r.price)}</td>
                <td className={`px-3 py-2 tabular-nums ${r.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pct(r.changePct)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-400">{inr(r.low)} - {inr(r.high)}</td>
                <td className="px-3 py-2 tabular-nums text-slate-400">{volume(r.volume)}</td>
                <td className="px-3 py-2">
                  <StatusBadges row={r} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">{asOf(r.asOf)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No stocks match your search.</td></tr>}
          </tbody>
        </table>
      </div>
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-200">Stocks</h1>
        <p className="text-xs text-slate-400">Indian stocks on NSE: Reliance, Tata group, Aditya Birla group and more. Paper trading for stocks is not available yet.</p>
      </div>
      <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">{res.data?.disclaimer || DISCLAIMER}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol or name" aria-label="Search stocks"
          className="focus-ring w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 sm:w-64"
        />
        <SegTabs tabs={SORTS} active={sort} onChange={setSort} label="Sort by" />
      </div>
      {selected && <StockChart key={selected.symbol} row={selected} onClose={() => setSel(null)} />}
      {body}
    </div>
  );
};

export default Stocks;
