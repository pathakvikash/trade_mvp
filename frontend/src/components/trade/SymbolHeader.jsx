import React, { useEffect, useRef, useState } from 'react';
import { fmtCompact, fmtCountdown, fmtPct, fmtPrice } from '../ui/fmt';

const Stat = ({ label, children }) => (
  <div className="min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className="text-xs tabular-nums text-slate-200">{children}</div>
  </div>
);

// Symbol switcher + live stats. 24h high/low/volume come from the futures overview (shows -- until it is served).
const SymbolHeader = ({ symbols, symbol, futuresSymbol, ready, candles, mark, overview, change: cgChange, onSymbol }) => {
  const ov = overview.find((r) => r.symbol === futuresSymbol) || null;
  const m = ready ? mark : null;

  const last = ready && candles.length ? candles[candles.length - 1].close : m?.markPrice ?? ov?.lastPrice;
  const tick = useRef({ sym: null, price: null, dir: 'up' });
  if (tick.current.sym !== futuresSymbol) tick.current = { sym: futuresSymbol, price: last ?? null, dir: 'up' };
  else if (last != null) {
    if (tick.current.price != null && last !== tick.current.price) tick.current.dir = last > tick.current.price ? 'up' : 'down';
    tick.current.price = last;
  }

  const nextFunding = m?.nextFundingTime ?? ov?.nextFundingTime;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!nextFunding) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextFunding]);

  const change = ov?.priceChangePercent ?? cgChange;
  const funding = m?.fundingRate ?? ov?.fundingRate;
  const money = (v) => (v == null ? '--' : `$${fmtPrice(v)}`);

  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-800/80 bg-slate-950/60 px-3 py-2.5" aria-label="Market summary">
      <div className="flex items-center gap-3">
        <select
          value={symbol}
          onChange={(e) => onSymbol(e.target.value)}
          aria-label="Symbol"
          className="focus-ring rounded-lg border border-slate-700 bg-slate-900 py-1 pl-2 pr-1 text-sm font-semibold text-slate-100"
        >
          {symbols.map((s) => <option key={s} value={s}>{s}USDT</option>)}
        </select>
        <div>
          <div className={`text-xl font-semibold tabular-nums ${tick.current.dir === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>{money(last)}</div>
        </div>
        <div className={`text-sm font-medium tabular-nums ${(change ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtPct(change)}</div>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        <Stat label="Mark">{money(m?.markPrice ?? ov?.markPrice)}</Stat>
        <Stat label="Index">{money(m?.indexPrice ?? ov?.indexPrice)}</Stat>
        <Stat label="Funding / countdown">
          <span className={(funding ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{funding == null ? '--' : `${(funding * 100).toFixed(4)}%`}</span>
          <span className="text-slate-500"> / </span>
          {nextFunding ? fmtCountdown(nextFunding - now) : '--'}
          {ov?.fundingIntervalHours ? <span className="text-slate-500"> ({ov.fundingIntervalHours}h)</span> : null}
        </Stat>
        <Stat label="24h high">{money(ov?.high)}</Stat>
        <Stat label="24h low">{money(ov?.low)}</Stat>
        <Stat label="24h volume">{ov?.quoteVolume == null ? '--' : `$${fmtCompact(ov.quoteVolume)}`}</Stat>
      </div>
    </section>
  );
};

export default SymbolHeader;
