// Public landing page at `/`. Copy is deliberately honest (CLAUDE.md rule 8): paper trading, estimates labelled, no invented stats.
import React from 'react';
import { Link } from 'react-router-dom';
import MarketStrip from '../components/ui/MarketStrip';
import Logo from '../components/ui/Logo';
import HomeStats from '../components/home/HomeStats';
import useUserStore from '../store/userStore';
import { landingPath } from '../lib/landing';

const PAPER_BALANCE = '$100,000'; // backend/models/User.js PAPER_BALANCE

const cta = 'focus-ring inline-flex min-h-[44px] items-center justify-center rounded-xl px-6 text-sm font-semibold transition';
const eyebrow = 'text-xs font-semibold uppercase tracking-widest text-brand-300';
const h2 = 'mt-2 text-2xl font-semibold tracking-tight text-white [text-wrap:balance] sm:text-3xl';

// ---- decorative mock visuals (aria-hidden, no images) ----
// Deterministic pseudo-random so the heat grid is stable between renders.
const heat = Array.from({ length: 60 }, (_, i) => ((i * 37 + 11) % 17) / 17);
const HeatGrid = () => (
  <div aria-hidden="true" className="grid grid-cols-10 gap-1">
    {heat.map((v, i) => (
      <span key={i} className="h-4 rounded-sm bg-amber-400 sm:h-5" style={{ opacity: 0.08 + v * v * 0.85 }} />
    ))}
  </div>
);

const candles = [[14, 10, 1], [9, 15, 1], [16, 12, 0], [7, 11, 1], [12, 18, 0], [5, 10, 1], [8, 14, 0]]; // [top, body height, up]
const Candles = () => (
  <svg aria-hidden="true" viewBox="0 0 112 40" className="h-16 w-full">
    <line x1="0" y1="9" x2="112" y2="9" className="stroke-emerald-500/50" strokeDasharray="3 3" />
    <line x1="0" y1="34" x2="112" y2="34" className="stroke-red-500/50" strokeDasharray="3 3" />
    {candles.map(([top, h, up], i) => (
      <g key={i} className={up ? 'text-emerald-400' : 'text-red-400'}>
        <line x1={8 + i * 15} y1={top} x2={8 + i * 15} y2={top + h + 8} stroke="currentColor" strokeWidth="1.5" />
        <rect x={5 + i * 15} y={top + 3} width="6" height={h} rx="1" fill="currentColor" />
      </g>
    ))}
  </svg>
);

const Bars = () => (
  <div aria-hidden="true" className="flex h-16 items-end gap-1.5">
    {[40, 62, 35, 80, 55, 70, 30, 48].map((h, i) => (
      <span key={i} className={`flex-1 rounded-t ${i % 3 === 0 ? 'bg-red-400/70' : 'bg-emerald-400/70'}`} style={{ height: `${h}%` }} />
    ))}
  </div>
);

const Bell = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-14 w-14 text-brand-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z" /><path d="M10 21h4" />
  </svg>
);

const Chat = () => (
  <div aria-hidden="true" className="space-y-2 text-xs">
    <div className="ml-auto w-3/4 rounded-xl rounded-br-sm bg-brand-600/30 px-3 py-2 text-brand-100">Why did funding flip?</div>
    <div className="w-5/6 space-y-1.5 rounded-xl rounded-bl-sm bg-slate-800 px-3 py-2.5">
      <span className="block h-1.5 w-full rounded bg-slate-600" /><span className="block h-1.5 w-2/3 rounded bg-slate-600" />
    </div>
  </div>
);

const FEATURES = [
  { name: 'Futures trading simulator', body: 'Open long and short positions with leverage, set take-profit and stop-loss, and watch the liquidation engine close positions the way an exchange would. Every fill uses the server price.', visual: <Candles />, wide: true },
  { name: 'Liquidation heatmap', body: 'See where leveraged positions may cluster. It is an estimated model built from market data, not exchange-reported positions.', visual: <HeatGrid /> },
  { name: 'Derivatives analytics', body: 'Funding rates, open interest and long/short ratios for the major USDS-M pairs, in one place.', visual: <Bars /> },
  { name: 'Alerts', body: 'Set price alerts and get notified when a level is hit.', visual: <Bell /> },
  { name: 'AI copilot', body: 'Ask questions about the market. Optional: bring your own API key from a supported provider, or leave it off.', visual: <Chat /> },
];

const STEPS = [
  ['Create a free account', 'Email and password, or Google. No card, no deposit.'],
  ['Get a paper balance', `Every account starts with ${PAPER_BALANCE} of simulated USD.`],
  ['Trade and review', 'Place spot and leveraged futures orders, then check your portfolio to see what worked.'],
];

const LIMITS = [
  ['Paper trading only', 'There is no real money, no deposits and no withdrawals. Nothing here can lose or make you a cent.'],
  ['Real market data', 'Prices come from Binance USDS-M futures. If Binance is unreachable, some data falls back to Bybit and is tagged as such.'],
  ['Estimates are labelled', 'The liquidation map and heatmap are modelled estimates, and the liquidation feed is a sample, not every event.'],
];

const FAQ = [
  ['Is it real money?', 'No. Everything is simulated with a paper balance. You cannot deposit or withdraw, and results do not predict live trading, where slippage, fees and funding differ.'],
  ['Where does the data come from?', 'Prices and derivatives data come from the public Binance USDS-M futures API, with a fallback to Bybit when Binance is unavailable.'],
  ['How is liquidation computed?', 'In the simulator, your position is closed when price reaches its computed liquidation level for your leverage and margin. The heatmap is different: it is an estimate of where other traders might be liquidated, derived from public market data.'],
  ['Do I need an API key for AI?', 'No. The AI copilot is optional. If you want it, add your own key in Settings; it is stored encrypted and never shown back to you.'],
];

const Home = () => {
  // Same signed-in test as ProtectedRoute (token && user). zustand persist reads localStorage synchronously, so no signed-out flash on first render.
  const signedIn = useUserStore((s) => !!(s.token && s.user));
  const dashboard = useUserStore((s) => landingPath(s.user?.preferences));
  const openDashboard = <Link to={dashboard} className={`${cta} bg-brand-600 text-white shadow-lg shadow-brand-600/20 hover:bg-brand-500`}>Open dashboard</Link>;
  return (
  <div className="relative isolate overflow-x-hidden bg-[#070b14] text-slate-100">
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40rem]">
      <div
        className="absolute inset-0 animate-auth-grid opacity-[0.35] motion-reduce:animate-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse at 50% 30%, black 20%, transparent 75%)',
          WebkitMaskImage: 'radial-gradient(ellipse at 50% 30%, black 20%, transparent 75%)',
        }}
      />
      <div className="absolute -left-24 -top-24 h-[26rem] w-[26rem] animate-auth-glow rounded-full bg-brand-600/25 blur-3xl motion-reduce:animate-none" />
      <div className="absolute right-0 top-40 h-[22rem] w-[22rem] animate-auth-glow rounded-full bg-emerald-500/10 blur-3xl [animation-delay:-6s] motion-reduce:animate-none" />
    </div>

    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="grid items-center gap-10 py-12 sm:py-16 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div className="animate-auth-rise motion-reduce:animate-none">
          <Logo withWordmark size={32} className="mb-6" />
          <p className={eyebrow}>Paper trading, real market data</p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight text-white [text-wrap:balance] sm:text-5xl lg:text-6xl">
            Practise leveraged crypto trading without risking real money.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Paperline runs a futures simulator on live Binance prices, with a liquidation engine, TP/SL orders and derivatives analytics. Learn how leverage behaves before it costs you anything.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {signedIn ? openDashboard : (<>
              <Link to="/register" className={`${cta} bg-brand-600 text-white shadow-lg shadow-brand-600/20 hover:bg-brand-500`}>Start free</Link>
              <Link to="/login" className={`${cta} border border-slate-700 bg-slate-900/60 text-slate-100 hover:border-slate-500`}>Sign in</Link>
            </>)}
          </div>
          <p className="mt-4 text-xs text-slate-400">{signedIn ? 'Simulated funds only.' : 'Simulated funds only. No card required.'}</p>
        </div>
        <div className="animate-auth-rise motion-reduce:animate-none [animation-delay:120ms]"><MarketStrip /></div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-h" className="py-12 sm:py-16">
        <p className={eyebrow}>What you get</p>
        <h2 id="features-h" className={h2}>Everything a futures desk shows you, minus the risk</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-6">
          {FEATURES.map((f, i) => (
            <article key={f.name} className={`flex flex-col justify-between gap-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 ring-1 ring-inset ring-white/5 transition hover:border-slate-700 sm:p-6 ${i === 0 ? 'lg:col-span-4' : i < 3 ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
              <div>
                <h3 className="text-lg font-semibold text-white">{f.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">{f.body}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">{f.visual}</div>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-h" className="py-12 sm:py-16">
        <p className={eyebrow}>How it works</p>
        <h2 id="how-h" className={h2}>From sign-up to first trade in three steps</h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-500/40 bg-brand-500/10 text-sm font-semibold text-brand-300">{i + 1}</span>
              <h3 className="mt-4 text-base font-semibold text-white">{t}</h3>
              <p className="mt-1.5 text-sm text-slate-300">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Honest limits */}
      <section aria-labelledby="limits-h" className="py-12 sm:py-16">
        <p className={eyebrow}>Know the limits</p>
        <h2 id="limits-h" className={h2}>What this is, and what it is not</h2>
        <dl className="mt-8 grid gap-4 md:grid-cols-3">
          {LIMITS.map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-slate-800 border-l-brand-500/60 bg-slate-900/70 p-5 sm:p-6 md:border-l-2">
              <dt className="text-base font-semibold text-white">{t}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-slate-300">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-h" className="mx-auto max-w-3xl py-12 sm:py-16">
        <h2 id="faq-h" className={h2}>Questions</h2>
        <div className="mt-6 divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5">
              <summary className="focus-ring flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-4 rounded-md py-3 text-sm font-medium text-slate-100 [&::-webkit-details-marker]:hidden">
                {q}
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180 motion-reduce:transition-none" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 8l5 5 5-5" /></svg>
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-slate-300">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <div className="flex flex-col items-start gap-2">
        <HomeStats />
        <Link to="/docs" className="focus-ring text-sm font-medium text-brand-300 hover:text-brand-200">Read the docs</Link>
      </div>

      {/* Closing CTA */}
      <section className="py-12 text-center sm:py-16">
        <h2 className="mx-auto max-w-xl text-2xl font-semibold tracking-tight text-white [text-wrap:balance] sm:text-3xl">Try your strategy before the market tries it for you</h2>
        <div className="mt-6 flex justify-center">
          {signedIn ? openDashboard : <Link to="/register" className={`${cta} bg-brand-600 text-white hover:bg-brand-500`}>Start free</Link>}
        </div>
      </section>

      <footer className="border-t border-slate-800 py-6 text-center text-sm text-slate-400">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1"><Logo withWordmark size={18} wordmarkClassName="text-sm font-semibold text-slate-300" className="gap-1.5" /><span>&copy; {new Date().getFullYear()} Paperline. Paper trading only. Not financial advice.</span> <Link to="/docs" className="underline-offset-2 hover:text-slate-200 hover:underline">Docs</Link></p>
      </footer>
    </div>
  </div>
  );
};

export default Home;
