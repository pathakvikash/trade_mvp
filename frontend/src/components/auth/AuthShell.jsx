// Shared look for /login and /register: brand + live market strip on the left (lg+), form card on the right.
import React, { useEffect, useState } from 'react';
import usePolling from '../../lib/usePolling';
import { API } from '../../lib/api';
import { fmtPct, fmtPrice } from '../ui/fmt';

const WANT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
const FEATURES = [
  'Live Binance futures prices, streamed',
  'Liquidation heatmap to see where leverage clusters',
  'TP/SL orders and a liquidation engine, like the real thing',
];

export const inputClass =
  'w-full rounded-xl border border-slate-700/70 bg-slate-950/80 px-4 py-3 text-base text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60 sm:text-sm';

export const Field = ({ id, label, hint, children }) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="text-sm font-medium text-slate-300">{label}</label>
    {children}
    {hint && <p className="text-xs text-slate-500">{hint}</p>}
  </div>
);

// Password input with an accessible show/hide button; extra props pass to the input.
export const PasswordInput = ({ id, ...rest }) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={shown ? 'text' : 'password'} className={`${inputClass} pr-16`} {...rest} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-slate-400 transition hover:text-slate-100"
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
};

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

const Logo = ({ className = '' }) => (
  <div className={`flex items-center gap-2.5 ${className}`}>
    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-500/40 bg-brand-500/10" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-4 w-4 text-brand-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-6 4 3 8-9" /><path d="M15 5h5v5" /></svg>
    </span>
    <span className="text-lg font-semibold tracking-tight text-white">CryptoZen</span>
  </div>
);

// busy = a sign-in request is in flight; after 4s say why it is slow (Render free tier cold start).
const AuthShell = ({ title, subtitle, busy = false, children }) => {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [busy]);

  return (
    <div className="relative isolate min-h-[calc(100dvh-4.25rem)] overflow-hidden bg-[#070b14] text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0 animate-auth-grid opacity-[0.35] motion-reduce:animate-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse at 30% 40%, black 20%, transparent 75%)',
          }}
        />
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] animate-auth-glow rounded-full bg-brand-600/25 blur-3xl motion-reduce:animate-none" />
        <div className="absolute -bottom-40 right-0 h-[24rem] w-[24rem] animate-auth-glow rounded-full bg-emerald-500/10 blur-3xl [animation-delay:-6s] motion-reduce:animate-none" />
      </div>

      <div className="mx-auto grid min-h-[inherit] max-w-6xl items-center gap-8 px-4 py-6 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:py-12">
        <aside className="order-2 space-y-8 lg:order-1">
          <div className="hidden space-y-6 lg:block">
            <Logo />
            <h2 className="max-w-md text-4xl font-semibold leading-tight tracking-tight text-white">
              Practice leveraged crypto trading with real Binance data. No real money.
            </h2>
            <ul className="space-y-3 text-sm text-slate-300">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="hidden max-w-md lg:block"><MarketStrip /></div>
        </aside>

        <main className="order-1 mx-auto w-full max-w-md animate-auth-rise motion-reduce:animate-none lg:order-2">
          <Logo className="mb-5 lg:hidden" />
          <p className="mb-5 text-sm text-slate-400 lg:hidden">Practice leveraged crypto trading with real Binance data. No real money.</p>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-soft ring-1 ring-inset ring-white/5 backdrop-blur-md sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
            <p className="mb-6 mt-1 text-sm text-slate-400">{subtitle}</p>
            {children}
            {slow && (
              <p role="status" className="mt-4 text-center text-xs text-slate-400">
                Waking up the server, this can take up to 30 seconds on the first request.
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default AuthShell;
