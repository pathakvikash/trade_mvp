import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import usePolling from '../../lib/usePolling';
import { API } from '../../lib/apiBase';
import { asOf, pct, price, StatusBadges } from '../../lib/instrumentFormat';
import Panel from '../ui/Panel';
import SegTabs from '../ui/SegTabs';
import Skeleton, { LoadingBlock } from '../ui/Skeleton';
import MaximizeButton, { MaximizeBackdrop } from '../ui/MaximizeButton';
import useMaximize from '../ui/useMaximize';
import CandleChart from '../trade/CandleChart';
import AgentLauncher from '../ai/AgentLauncher';
import StrategyChip from '../ai/StrategyChip';
import useStrategyOverlay from '../../lib/useStrategyOverlay';
import freshCandles from '../../lib/freshCandles';
import useScrollIntoView from '../../lib/useScrollIntoView';
import QuoteList from '../ui/QuoteList';

const DISCLAIMER = 'Unofficial Yahoo Finance data, may be delayed, view only, not investment advice.';
const TIMEFRAMES = ['5m', '15m', '1h', '1d'].map((id) => ({ id, label: id }));
const CATS = [
  { id: 'stock', label: 'Stocks' },
  { id: 'index', label: 'Indices' },
  { id: 'commodity', label: 'Gold & crude' },
  { id: 'currency', label: 'Currency' },
];

const InstrumentChart = ({ row, onClose }) => {
  const [tf, setTf] = useState('1d');
  const mx = useMaximize();
  const boxRef = useScrollIntoView();
  const k = usePolling(`${API}/api/market/instruments/klines/${encodeURIComponent(row.symbol)}?interval=${tf}&limit=200`, 60000);
  const candles = freshCandles(k.data, row.symbol, tf);
  const ov = useStrategyOverlay({ kind: 'instrument', symbol: row.symbol, interval: tf, candles });
  let body;
  if (k.error && !candles.length) body = <div className="flex h-full items-center justify-center text-sm text-rose-300">Unable to load candles.</div>;
  else if (k.loading || !candles.length) body = <LoadingBlock height={320} label="Loading candles…" />;
  else body = <CandleChart key={`${row.symbol}-${tf}`} candles={candles} reloadSeq={0} label={`${row.symbol} ${tf} candlestick chart`} overlays={ov.overlays} markers={ov.markers} strategyChip={<StrategyChip chip={ov.chip} />} />;
  return (
    <div ref={boxRef} className="scroll-mt-3">
      <MaximizeBackdrop max={mx.max} onClose={mx.exit} />
      <Panel
        title={`${row.symbol} · ${row.name}`}
        {...mx.panelProps}
        className={`shrink-0 ${mx.panelClass}`} bodyClassName="relative h-[340px] min-h-[340px] p-1.5 pt-2"
        right={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AgentLauncher kind="instrument" symbol={row.symbol} page="markets" interval={tf} />
            <SegTabs tabs={TIMEFRAMES} active={tf} onChange={setTf} label="Timeframe" />
            <MaximizeButton max={mx.max} onToggle={mx.toggle} />
            <button type="button" onClick={onClose} className="focus-ring rounded-md px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Close</button>
          </div>
        }
      >
        {body}
      </Panel>
    </div>
  );
};

// Curated real-world instruments, view only. Idle (no request) until the panel is opened.
const RealMarkets = () => {
  // ?instrument=GOLD&category=commodity (from the header search) opens the panel on that instrument
  // The page stays mounted when a later search lands on /derivatives again, so sync on change instead of reading once.
  const [params] = useSearchParams();
  const wanted = params.get('instrument');
  const wantedCat = CATS.some((c) => c.id === params.get('category')) ? params.get('category') : 'stock';
  const [open, setOpen] = useState(!!wanted);
  const [cat, setCat] = useState(wantedCat);
  const [sel, setSel] = useState(wanted);
  useEffect(() => {
    if (!wanted) return;
    setOpen(true); setCat(wantedCat); setSel(wanted);
  }, [wanted, wantedCat]);
  const [retry, setRetry] = useState(0);
  const res = usePolling(open ? `${API}/api/market/instruments/quotes?category=${cat}` : null, 60000, retry, undefined, true);
  const rows = Array.isArray(res.data?.rows) ? res.data.rows : null;
  const selected = rows?.find((r) => r.symbol === sel) || null;

  let body;
  if (res.error && !rows) {
    body = (
      <div role="alert" className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-rose-400/30 p-6 text-sm text-rose-300">
        <span>Market data is unavailable right now.</span>
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="focus-ring rounded-md border border-rose-300/40 px-3 py-1 text-xs hover:bg-rose-300/10">Retry</button>
      </div>
    );
  } else if (!rows) {
    body = <div role="status" aria-label="Loading real markets" className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  } else {
    // inner-scrolling table keeps the page itself free of horizontal scroll at 360px
    body = (
      <>
      <QuoteList rows={rows} selected={sel} onSelect={setSel} fmt={(r) => price(r, r.price)} empty="No instruments." />
      <div className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-800/80 sm:block">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-slate-500">
            <tr>{['Instrument', 'Price', 'Change %', 'Status', 'As of'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} onClick={() => setSel(r.symbol)} className={`cursor-pointer border-t border-slate-800/60 hover:bg-slate-900/60 ${sel === r.symbol ? 'bg-slate-900/80' : ''}`}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setSel(r.symbol)} aria-label={`Show chart for ${r.symbol}`} className="focus-ring rounded text-left font-medium text-slate-200">{r.symbol}</button>
                  <div className="text-xs text-slate-500">{r.name}</div>
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-200">{price(r, r.price)}</td>
                <td className={`px-3 py-2 tabular-nums ${r.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{pct(r.changePct)}</td>
                <td className="px-3 py-2"><StatusBadges row={r} /></td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-400">{asOf(r.asOf)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No instruments.</td></tr>}
          </tbody>
        </table>
      </div>
      </>
    );
  }

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-slate-800/80 bg-slate-950/60 p-3" aria-label="Real markets">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="focus-ring flex w-full items-center justify-between gap-2 rounded text-left">
        <span className="text-sm font-semibold text-slate-200">Real markets <span className="text-xs font-normal text-slate-400">stocks, indices, gold, crude, currency · View only</span></span>
        <span aria-hidden="true" className="text-slate-400">{open ? '−' : '+'}</span>
      </button>
      <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">{res.data?.disclaimer || DISCLAIMER}</p>
      {open && (
        <>
          <div className="max-w-full overflow-x-auto"><SegTabs tabs={CATS} active={cat} onChange={(c) => { setCat(c); setSel(null); }} label="Market category" /></div>
          {selected && <InstrumentChart key={selected.symbol} row={selected} onClose={() => setSel(null)} />}
          {body}
        </>
      )}
    </section>
  );
};

export default RealMarkets;
