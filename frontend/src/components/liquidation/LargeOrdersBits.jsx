import React from 'react';
import { fmtMarketPrice, fmtUsd } from './shared';
import { ladderPos, ladderRange } from './orderflow';

export const chipCls = (on) => `focus-ring min-h-[44px] min-w-[44px] shrink-0 rounded-md px-3 text-xs font-medium ${on ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`;
const PILL = { emerald: 'border-emerald-500/40 text-emerald-300', amber: 'border-amber-500/40 text-amber-300', cyan: 'border-cyan-500/40 text-cyan-300', slate: 'border-slate-700 text-slate-400' };
export const StatusPill = ({ label, tone }) => <span data-testid="status-pill" className={`inline-flex min-h-[28px] items-center rounded-full border px-2.5 text-[11px] font-medium ${PILL[tone] || PILL.slate}`}>{label}</span>;

export const StatCard = ({ label, children }) => (
  <div className="min-w-0 rounded-lg border border-slate-800/80 bg-slate-900/40 p-2.5">
    <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
    <div className="mt-1 text-sm tabular-nums text-slate-200">{children}</div>
  </div>
);
export const Sub = ({ children }) => <p className="mt-0.5 text-[11px] text-slate-400">{children}</p>;
export const sideCls = (s) => (s === 'bid' || s === 'buy' ? 'text-emerald-400' : 'text-rose-400');

// Two-colour share bar (buys green / sells red).
export const ShareBar = ({ buy, sell, label }) => {
  const pct = buy + sell > 0 ? (buy / (buy + sell)) * 100 : 50;
  return (
    <div role="img" aria-label={label} className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-800">
      <div className="bg-emerald-500" style={{ width: `${pct}%` }} /><div className="bg-rose-500" style={{ width: `${100 - pct}%` }} />
    </div>
  );
};

// Large-trade USD per minute, buys green over sells red. `bars` = [{ t, buyUsd, sellUsd, n }] oldest first.
export const WhalePrints = ({ bars, windowMs, minLabel }) => {
  const W = 300; const H = 70; const gap = 3;
  const bw = W / bars.length - gap;
  const max = Math.max(...bars.map((b) => b.buyUsd + b.sellUsd), 0);
  const total = bars.reduce((n, b) => n + b.n, 0);
  const sy = (v) => (max > 0 ? (v / max) * (H - 4) : 0);
  return (
    <div data-testid="whale-prints" className="mt-3">
      <div className="flex items-baseline justify-between gap-2"><h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Whale prints, per minute</h3><span className="text-[11px] tabular-nums text-slate-500">{max > 0 ? `peak ${fmtUsd(max)}` : ''}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Large trades of ${minLabel} or more per minute over the last ${bars.length} minutes: ${total} prints`} className="mt-1 h-20 w-full">
        <line x1="0" y1={H - 0.5} x2={W} y2={H - 0.5} stroke="currentColor" className="text-slate-800" />
        {bars.map((b, i) => {
          const x = i * (bw + gap) + gap / 2; const hs = sy(b.sellUsd); const hb = sy(b.buyUsd);
          return (
            <g key={b.t}>
              <title>{`${new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: buys ${fmtUsd(b.buyUsd)}, sells ${fmtUsd(b.sellUsd)}, ${b.n} prints`}</title>
              <rect x={x} y={H - 1 - hs} width={bw} height={hs} className="fill-rose-500" />
              <rect x={x} y={H - 1 - hs - hb} width={bw} height={hb} className="fill-emerald-500" />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500"><span>{bars.length} min ago</span><span>now</span></div>
      <p className="mt-1 text-[11px] text-slate-500">
        {windowMs < bars.length * 60e3 ? `The latest 1000 trades only reach back ${Math.max(1, Math.round(windowMs / 60e3))} min on this coin, so older minutes are empty, not quiet. ` : ''}
        {total === 0 ? `No trades of ${minLabel} or more in this window.` : 'Green = taker buys, red = taker sells.'}
      </p>
    </div>
  );
};

// Tiny strip: current price in the middle, every listed row a dot, the clicked one big with its price and distance.
export const PriceLadder = ({ ref0, prices, selected }) => {
  if (!(ref0 > 0)) return null;
  const dist = (p) => ((p - ref0) / ref0) * 100;
  const range = ladderRange([...prices, ...(selected != null ? [selected] : [])].map(dist)); // zoom to the listed rows, 25% steps
  const s = selected != null ? ladderPos(selected, ref0, range) : null;
  return (
    <div data-testid="price-ladder" className="mb-2 rounded-md border border-slate-800/80 bg-slate-900/40 px-3 pb-1 pt-2">
      <div className="relative h-6" role="img" aria-label={s ? `Selected price ${fmtMarketPrice(selected)}, ${s.distPct >= 0 ? '+' : ''}${s.distPct.toFixed(2)} percent from the current price` : 'Price ladder: click a row to place its price'}>
        <div className="absolute inset-x-0 top-3 h-px bg-slate-700" />
        {prices.map((p, i) => <i key={`${p}-${i}`} className="absolute top-[10px] h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-slate-600" style={{ left: `${ladderPos(p, ref0, range).pct}%` }} />)}
        <i className="absolute top-1 h-4 w-0.5 -translate-x-1/2 bg-cyan-400" style={{ left: '50%' }} />
        {s && <i data-testid="ladder-sel" className="absolute top-[7px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-amber-300 bg-amber-400/40" style={{ left: `${s.pct}%` }} />}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-500"><span>-{range}%</span><span className="text-cyan-300">now {fmtMarketPrice(ref0)}</span><span>+{range}%</span></div>
      <p className="text-[11px] text-slate-300" aria-live="polite">{s ? `Selected ${fmtMarketPrice(selected)}: ${s.distPct >= 0 ? '+' : ''}${s.distPct.toFixed(2)}% from price${s.off ? ' (off the strip)' : ''}` : 'Click a row to see where its price sits.'}</p>
    </div>
  );
};
