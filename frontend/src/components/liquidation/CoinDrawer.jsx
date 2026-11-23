import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePolling from '../../lib/usePolling';
import { writePersisted } from '../../lib/usePersistedState';
import { FUT, Notice, coin, fmtPct, fmtMarketPrice, fmtPrice, fmtTime, fmtUsd } from './shared';
import Skeleton from '../ui/Skeleton';
import { dominantSide, insightText, summarizeCoin } from './coinStats';

const BIG = 100000;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
const label = 'text-[11px] font-medium uppercase tracking-wider text-slate-500';
const btn = 'focus-ring rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800';
const hh = (t) => `${new Date(t).getHours().toString().padStart(2, '0')}:00`;

const Stat = ({ k, children }) => (
  <div className="rounded-lg border border-slate-800/80 p-2">
    <div className={label}>{k}</div>
    <div className="mt-0.5 text-sm font-semibold tabular-nums text-slate-200">{children}</div>
  </div>
);

// 24 hourly stacked bars (longs bottom/green, shorts top/red) in plain SVG; hover or focus a bar for its numbers.
const Timeline = ({ hours }) => {
  const [hi, setHi] = useState(null);
  const max = Math.max(1, ...hours.map((h) => h.long + h.short));
  const cur = hi === null ? null : hours[hi];
  return (
    <div className="relative">
      <div className="h-5 text-[11px] tabular-nums text-slate-400" aria-live="polite">
        {cur ? <>{hh(cur.t)} · <span className="text-emerald-400">L {fmtUsd(cur.long)}</span> · <span className="text-rose-400">S {fmtUsd(cur.short)}</span> · {cur.count} events</> : 'Hover a bar for details'}
      </div>
      <svg viewBox="0 0 240 80" preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label="Sampled liquidations per hour, last 24 hours" onMouseLeave={() => setHi(null)}>
        {hours.map((h, i) => {
          const lh = (h.long / max) * 78;
          const sh = (h.short / max) * 78;
          return (
            <g key={h.t} onMouseEnter={() => setHi(i)} className={hi === i ? 'opacity-100' : hi === null ? 'opacity-90' : 'opacity-50'}>
              <rect x={i * 10} y={0} width={10} height={80} fill="transparent" />
              <rect x={i * 10 + 1} y={80 - lh} width={8} height={lh} fill="#34d399" />
              <rect x={i * 10 + 1} y={80 - lh - sh} width={8} height={sh} fill="#fb7185" />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-500">
        <span>{hh(hours[0].t)}</span><span>{hh(hours[12].t)}</span><span>now</span>
      </div>
    </div>
  );
};

const CoinDetail = ({ symbol, bySymbol, onClose }) => {
  const navigate = useNavigate();
  const panel = useRef(null);
  const liq = usePolling(`${FUT}/liquidations/${symbol}`, 30000);
  const ov = usePolling(`${FUT}/overview`, 30000);
  const [copied, setCopied] = useState('');
  const c = coin(symbol);

  const summary = useMemo(() => (liq.data ? summarizeCoin(liq.data.events, liq.data.since) : null), [liq.data]);
  const rankIdx = (bySymbol || []).findIndex((r) => r.symbol === symbol);
  const row = rankIdx >= 0 ? bySymbol[rankIdx] : null;
  const mkt = useMemo(() => (Array.isArray(ov.data) ? ov.data.find((r) => r.symbol === symbol) : null) || null, [ov.data, symbol]);
  // header shows the summary row (already on screen) until this coin's buffer arrives
  const head = summary || (row && { total: row.longUsd + row.shortUsd, longUsd: row.longUsd, shortUsd: row.shortUsd, count: row.count, longPct: row.longUsd + row.shortUsd ? (row.longUsd / (row.longUsd + row.shortUsd)) * 100 : 50 });
  const insight = summary ? insightText(summary, { coin: c, changePct: mkt?.priceChangePercent, fmtPrice, fmtUsd }) : '';
  const windowH = summary ? Math.max(0.1, summary.windowMs / 3600e3) : 24;
  const sampleNote = windowH >= 23.9 ? 'last 24h' : `last ${windowH.toFixed(1)}h only (buffer started ${fmtTime(Date.now() - summary.windowMs)})`;

  // Esc closes, Tab cycles inside the dialog, focus goes back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.querySelector('[data-autofocus]')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !panel.current) return;
      const f = [...panel.current.querySelectorAll(FOCUSABLE)];
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus(); };
  }, [onClose]);

  const openTrade = () => { writePersisted('trade.symbol', c); navigate('/trade'); };
  const copy = async () => {
    const lines = [
      `${c} liquidations, ${sampleNote} (sampled from the Binance forceOrder feed; real totals are higher)`,
      head ? `Total ${fmtUsd(head.total)} | longs ${head.longPct.toFixed(0)}% / shorts ${(100 - head.longPct).toFixed(0)}% | ${head.count} events` : '',
      mkt ? `Price ${fmtMarketPrice(mkt.lastPrice)} (${fmtPct(mkt.priceChangePercent)} 24h)` : '',
      insight,
    ].filter(Boolean);
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied('Copied'); } catch { setCopied('Copy failed'); }
  };

  const side = head ? dominantSide(head.longPct) : null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" data-testid="backdrop" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coin-detail-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-slate-800 bg-[#070b14] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[460px] sm:rounded-none sm:border-l sm:border-t-0"
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <h2 id="coin-detail-title" className="text-lg font-semibold text-slate-100">{c} liquidations</h2>
            <div className="text-xs tabular-nums text-slate-400">
              {mkt ? <>{fmtMarketPrice(mkt.lastPrice)} <span className={mkt.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtPct(mkt.priceChangePercent)}</span> 24h</> : ov.data ? 'Price: not in the top-40 overview' : ov.error ? 'Price unavailable, retrying' : <Skeleton className="h-3 w-32" />}
            </div>
          </div>
          <button type="button" data-autofocus onClick={onClose} aria-label="Close details" className="focus-ring rounded-md px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {!head && liq.error ? <Notice tone="error">Liquidation data unavailable, retrying.</Notice> : !head ? (
            <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : (
            <section aria-label="Totals">
              <div className="flex items-baseline justify-between">
                <span className={label}>Liquidated, {sampleNote}</span>
                <span className="text-xl font-semibold tabular-nums text-slate-100" data-testid="total">{fmtUsd(head.total)}</span>
              </div>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`Longs ${head.longPct.toFixed(0)} percent, shorts ${(100 - head.longPct).toFixed(0)} percent`}>
                {head.total > 0 && <><div className="bg-emerald-400" style={{ width: `${head.longPct}%` }} /><div className="bg-rose-400" style={{ width: `${100 - head.longPct}%` }} /></>}
              </div>
              <div className="mt-1 flex justify-between text-xs tabular-nums">
                <span className="text-emerald-400">Longs {fmtUsd(head.longUsd)} ({head.longPct.toFixed(0)}%)</span>
                <span className="text-rose-400">Shorts {fmtUsd(head.shortUsd)} ({(100 - head.longPct).toFixed(0)}%)</span>
              </div>
              <p className="mt-1 text-xs text-slate-300" data-testid="dominant">Dominant side: {side === 'balanced' ? 'balanced' : side === 'long' ? 'longs' : 'shorts'}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat k="Events">{head.count}</Stat>
                <Stat k="Average">{summary ? fmtUsd(summary.avg) : '--'}</Stat>
                <Stat k="Largest">{summary?.largest ? fmtUsd(summary.largest.usd) : '--'}</Stat>
                <Stat k="Rank">{row ? `#${rankIdx + 1} of ${bySymbol.length}` : 'outside top 50'}</Stat>
              </div>
            </section>
          )}

          {summary && summary.count > 0 && <p className="rounded-lg border border-slate-800 bg-slate-900/50 p-2 text-xs text-slate-300" data-testid="insight">{insight}</p>}

          <section aria-label="Hourly timeline">
            <div className={label}>Per hour (sampled)</div>
            {!summary ? (liq.error ? <Notice tone="error">Unavailable.</Notice> : <Skeleton className="mt-2 h-24 w-full" />) : summary.count === 0 ? <Notice>No sampled liquidations for {c} in the {sampleNote}.</Notice> : <Timeline hours={summary.hours} />}
          </section>

          {summary && summary.count > 0 && (
            <section aria-label="Largest events">
              <div className="flex items-baseline justify-between"><span className={label}>Largest sampled events</span><span className="text-[11px] text-amber-400">highlighted: $100K+</span></div>
              <table className="mt-1 w-full text-xs tabular-nums">
                <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr><th className="px-2 py-1 font-medium">Time</th><th className="px-2 py-1 font-medium">Side</th><th className="px-2 py-1 text-right font-medium">Price</th><th className="px-2 py-1 text-right font-medium">USD</th></tr>
                </thead>
                <tbody>
                  {summary.top.map((e) => (
                    <tr key={`${e.ts}${e.price}${e.usd}`} className={`border-t border-slate-800/60 ${e.usd >= BIG ? 'bg-amber-400/10 font-semibold' : ''}`}>
                      <td className="px-2 py-1 text-slate-400">{fmtTime(e.ts)}</td>
                      <td className={`px-2 py-1 ${e.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>{e.side === 'long' ? 'Long liq' : 'Short liq'}</td>
                      <td className="px-2 py-1 text-right text-slate-300">{fmtMarketPrice(e.price)}</td>
                      <td className={`px-2 py-1 text-right ${e.usd >= BIG ? 'text-amber-400' : 'text-slate-200'}`}>{fmtUsd(e.usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section aria-label="Market context">
            <div className={label}>Context</div>
            <dl className="mt-1 space-y-1 text-xs tabular-nums">
              <div className="flex justify-between"><dt className="text-slate-400">Funding rate</dt><dd className="text-slate-200">{mkt && Number.isFinite(mkt.fundingRate) ? `${(mkt.fundingRate * 100).toFixed(4)}%${mkt.fundingIntervalHours > 0 ? ` / ${mkt.fundingIntervalHours}h` : ''}` : '--'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">Open interest</dt><dd className="text-slate-200">{mkt?.openInterestUsd != null ? fmtUsd(mkt.openInterestUsd) : '--'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-400">24h volume</dt><dd className="text-slate-200">{mkt ? fmtUsd(mkt.quoteVolume) : '--'}</dd></div>
            </dl>
          </section>
          <p className="text-[11px] text-slate-500">Realized liquidations are sampled: Binance publishes at most one per symbol per second, so real totals are higher. Descriptive only, not a forecast.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 p-3">
          <button type="button" onClick={openTrade} className={`${btn} border-cyan-500/60 text-cyan-200`}>Open in Trade</button>
          <button type="button" onClick={() => navigate(`/trade?symbol=${c}&alerts=1`)} className={btn}>Set alert</button>
          <button type="button" onClick={copy} className={btn}>Copy summary</button>
          <span className="text-[11px] text-slate-400" aria-live="polite">{copied}</span>
        </div>
      </div>
    </div>
  );
};

export default CoinDetail;
