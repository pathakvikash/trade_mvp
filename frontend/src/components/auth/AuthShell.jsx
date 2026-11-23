// Shared look for /login and /register: brand + live market strip on the left (lg+), form card on the right.
import React, { useEffect, useState } from 'react';
import MarketStrip from '../ui/MarketStrip';

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
