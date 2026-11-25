import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import usePolling from '../../lib/usePolling';
import { API } from '../../lib/apiBase';
import { fmtUsd, fmtPct } from '../ui/fmt';

// Live stats strip for the home page. Every number comes from our own public API; a card whose request fails shows '--',
// never a made-up value. Refreshes every 60 s (usePolling). Counts animate for ~800 ms unless motion is reduced.
const POLL_MS = 60000;
const DUR = 800;
const base = `${API}/api/market`;

const motionReduced = () => {
  if (document.documentElement.dataset.reduceMotion === 'true') return true;
  const m = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  return !!(m && m.matches);
};

// Eases the shown number from its previous value to `value`; shows it at once under reduced motion.
const useCountUp = (value) => {
  const [shown, setShown] = useState(() => (motionReduced() ? value : 0));
  const from = useRef(0);
  useEffect(() => {
    if (!Number.isFinite(value)) return undefined;
    if (motionReduced() || typeof requestAnimationFrame !== 'function') { setShown(value); from.current = value; return undefined; }
    const start = from.current;
    const t0 = performance.now();
    let id;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / DUR);
      const v = start + (value - start) * (1 - (1 - p) ** 3);
      from.current = v;
      setShown(v);
      if (p < 1) id = requestAnimationFrame(tick); else { from.current = value; setShown(value); }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [value]);
  return Number.isFinite(value) ? shown : NaN;
};

const Num = ({ value, format }) => {
  const v = useCountUp(value);
  return <>{Number.isFinite(v) ? format(v) : '--'}</>;
};

const rowsOf = (d) => (Array.isArray(d) ? d : Array.isArray(d && d.rows) ? d.rows : null);
const pending = (r) => !r || (!r.data && !r.error);
const failed = (r) => !!r && !r.data && !!r.error;
const finite = (n) => (n === null || n === undefined || n === '' ? NaN : Number(n));

// Biggest 24 h gainer / loser and highest funding rate among the overview's listed perpetuals (top 40 by volume).
export const pulseOf = (rows) => {
  const ok = (rows || []).filter((r) => r && r.symbol && Number.isFinite(finite(r.priceChangePercent)));
  if (!ok.length) return null;
  const by = (key, dir) => ok.filter((r) => Number.isFinite(finite(r[key]))).sort((a, b) => dir * (finite(b[key]) - finite(a[key])))[0] || null;
  return { gainer: by('priceChangePercent', 1), loser: by('priceChangePercent', -1), funding: by('fundingRate', 1) };
};

const Card = ({ to, label, sub, res, children }) => (
  <li className="min-w-0">
    <Link to={to} className="focus-ring block h-24 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 hover:border-slate-700 sm:p-4">
      <span className="block truncate text-xs text-slate-400">{label}</span>
      <span className="mt-1 block text-xl font-semibold tabular-nums text-white sm:text-2xl">
        {pending(res) ? <span aria-hidden="true" className="mt-1 block h-6 w-20 rounded bg-slate-800 motion-safe:animate-pulse" /> : children}
      </span>
      <span className="mt-0.5 block truncate text-[11px] text-slate-500">{sub}</span>
    </Link>
  </li>
);

const Pulse = ({ label, row, text, to }) => (
  <li className="min-w-0">
    <Link to={to} className="focus-ring block rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 hover:border-slate-700">
      <span className="block text-[11px] text-slate-500">{label}</span>
      <span className="block truncate text-sm tabular-nums text-slate-200">{row ? `${row.symbol.replace(/USDT$/, '')} ${text(row)}` : '--'}</span>
    </Link>
  </li>
);

const HomeStats = () => {
  const syms = usePolling(`${base}/futures/symbols`, POLL_MS) || {};
  const inst = usePolling(`${base}/instruments/quotes`, POLL_MS) || {};
  const prov = usePolling(`${base}/providers`, POLL_MS) || {};
  const liq = usePolling(`${base}/futures/liquidations`, POLL_MS) || {};
  const ov = usePolling(`${base}/futures/overview`, POLL_MS) || {};

  const nSyms = rowsOf(syms.data) ? rowsOf(syms.data).length : NaN;
  const nInst = rowsOf(inst.data) ? rowsOf(inst.data).length : NaN;
  const plist = prov.data && Array.isArray(prov.data.providers) ? prov.data.providers : null;
  const up = plist ? plist.filter((p) => p && (p.breaker ? p.breaker.state : p.state) === 'closed').length : NaN;
  const w = liq.data && liq.data.windows && liq.data.windows['24h'];
  const liqUsd = w ? finite(w.longUsd) + finite(w.shortUsd) : NaN;
  const pulse = pulseOf(rowsOf(ov.data));
  const ovPending = pending(ov);
  const pct = (r) => fmtPct(r.priceChangePercent);
  const fund = (r) => `${(finite(r.fundingRate) * 100).toFixed(4)}%`;

  return (
    <section aria-labelledby="home-stats-h" className="py-8 sm:py-10">
      <h2 id="home-stats-h" className="text-lg font-semibold tracking-tight text-white">Live from our API</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card to="/market" label="Perp markets" sub="USDS-M perpetuals tracked" res={syms}>
          {failed(syms) || !Number.isFinite(nSyms) ? '--' : <Num value={nSyms} format={(v) => Math.round(v)} />}
        </Card>
        <Card to="/stocks" label="Instruments" sub="Real-market, view only" res={inst}>
          {failed(inst) || !Number.isFinite(nInst) ? '--' : <Num value={nInst} format={(v) => Math.round(v)} />}
        </Card>
        <Card to="/docs#data" label="Providers up" sub={plist ? `of ${plist.length} (breaker closed)` : 'status unavailable'} res={prov}>
          {failed(prov) || !Number.isFinite(up) ? '--' : <Num value={up} format={(v) => Math.round(v)} />}
        </Card>
        <Card to="/liquidation" label="Liquidations 24 h" sub="Sampled; less after restart" res={liq}>
          {failed(liq) || !Number.isFinite(liqUsd) ? '--' : <Num value={liqUsd} format={fmtUsd} />}
        </Card>
      </ul>
      <h3 className="mt-5 text-sm font-medium text-slate-300">Market pulse</h3>
      <p className="text-[11px] text-slate-500">From live Binance data, 24 h, top 40 perpetuals by volume. Not a signal.</p>
      <ul className="mt-2 grid min-h-[3.5rem] grid-cols-1 gap-2 sm:grid-cols-3">
        {ovPending ? [0, 1, 2].map((i) => <li key={i} aria-hidden="true" className="h-[3.25rem] rounded-xl border border-slate-800 bg-slate-900/50 motion-safe:animate-pulse" />) : (
          <>
            <Pulse to="/derivatives" label="Top 24 h gainer" row={pulse && pulse.gainer} text={pct} />
            <Pulse to="/derivatives" label="Top 24 h loser" row={pulse && pulse.loser} text={pct} />
            <Pulse to="/derivatives" label="Highest funding rate" row={pulse && pulse.funding} text={fund} />
          </>
        )}
      </ul>
    </section>
  );
};

export default HomeStats;
