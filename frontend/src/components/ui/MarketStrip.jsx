// Live USDS-M futures strip (BTC, ETH, SOL, BNB, XRP) from the public overview endpoint; skeleton rows while loading or failed.
import React from 'react';
import usePolling from '../../lib/usePolling';
import { API } from '../../lib/api';
import { fmtPct, fmtPrice } from './fmt';

const WANT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

// 24h range bar from real high/low/last: where price sits in today's range.
const RangeBar = ({ row, up }) => {
  const hi = Number(row.high), lo = Number(row.low), last = Number(row.lastPrice);
  const pos = hi > lo ? Math.min(1, Math.max(0, (last - lo) / (hi - lo))) : 0.5;
  return (
    <svg viewBox="0 0 64 12" className="h-3 w-16" aria-hidden="true">
      <line x1="2" y1="6" x2="62" y2="6" className="stroke-slate-700" strokeWidth="2" strokeLinecap="round" />
      <line x1="2" y1="6" x2={2 + pos * 60} y2="6" className={up ? 'stroke-emerald-500/70' : 'stroke-red-500/70'} strokeWidth="2" strokeLinecap="round" />
      <circle cx={2 + pos * 60} cy="6" r="3" className={up ? 'fill-emerald-400' : 'fill-red-400'} />
    </svg>
  );
};

const Row = ({ row, placeholder }) => {
  const sym = (row?.symbol || placeholder).replace('USDT', '');
  if (!row) {
    return (
      <li className="flex items-center justify-between gap-3 px-3 py-2.5">
        <span className="text-sm font-medium text-slate-400">{sym}</span>
        <span className="relative h-3 w-24 overflow-hidden rounded bg-slate-800/80" aria-hidden="true">
          <span className="absolute inset-0 animate-auth-sweep bg-gradient-to-r from-transparent via-slate-600/40 to-transparent motion-reduce:animate-none" />
        </span>
      </li>
    );
  }
  const pct = Number(row.priceChangePercent);
  const up = pct >= 0;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 tabular-nums">
      <span className="w-10 text-sm font-semibold text-slate-200">{sym}</span>
      <RangeBar row={row} up={up} />
      <span className="ml-auto text-sm text-slate-100">{fmtPrice(row.lastPrice)}</span>
      <span className={`w-16 text-right text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(pct)}</span>
    </li>
  );
};

export const MarketStrip = () => {
  const { data } = usePolling(`${API}/api/market/futures/overview`, 15000);
  const byId = Array.isArray(data) ? Object.fromEntries(data.map((r) => [r.symbol, r])) : {};
  const live = WANT.some((s) => byId[s]);
  return (
    <section aria-label="Live futures prices" className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/60 backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        <span>USDS-M futures, 24h</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70 motion-reduce:animate-none" />}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </span>
          {live ? 'Live' : 'Connecting'}
        </span>
      </header>
      <ul className="divide-y divide-slate-800/70">
        {WANT.map((s) => <Row key={s} row={byId[s]} placeholder={s} />)}
      </ul>
    </section>
  );
};

export default MarketStrip;
