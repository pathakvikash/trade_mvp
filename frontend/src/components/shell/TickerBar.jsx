import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useMarketStore from '../../store/marketStore';
import useUserStore from '../../store/userStore';
import { fmtCountdown, fmtPct, fmtMarketPrice } from '../ui/fmt';

const FUNDING_MS = 8 * 3600 * 1000;
// Most Binance USDS-M perps settle at 00:00, 08:00 and 16:00 UTC, which is every 8h counted from the epoch.
export const msToNextFunding = (now) => (Math.floor(now / FUNDING_MS) + 1) * FUNDING_MS - now;

const SECONDS_PER_ITEM = { slow: 4, normal: 2.5, fast: 1.4 };
const FUNDING_TIP = 'Most perps on Binance USDS-M settle funding every 8 hours (00:00, 08:00, 16:00 UTC); a few use shorter intervals. Paper futures here do not charge or pay funding, so this is for reference only.';

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const Item = ({ c, focusable }) => {
  const up = (c.price_change_percentage_24h ?? 0) >= 0;
  return (
    <Link to={`/trade?symbol=${c.symbol.toUpperCase()}`} tabIndex={focusable ? undefined : -1} className="focus-ring flex shrink-0 items-baseline gap-1.5 rounded tabular-nums">
      <span className="font-medium text-slate-300">{c.symbol.toUpperCase()}</span>
      <span className="text-slate-400">{fmtMarketPrice(c.current_price)}</span>
      <span className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtPct(c.price_change_percentage_24h)}</span>
    </Link>
  );
};

const TickerBar = () => {
  const user = useUserStore((s) => s.user);
  const prefs = user?.preferences || {};
  const marketData = useMarketStore((s) => s.marketData);
  const funding = prefs.fundingCountdown !== false;
  const [left, setLeft] = useState(() => msToNextFunding(Date.now()));

  useEffect(() => {
    if (!funding) return undefined;
    const id = setInterval(() => setLeft(msToNextFunding(Date.now())), 1000);
    return () => clearInterval(id);
  }, [funding]);

  if (!user || prefs.tickerBar === false) return null;
  const items = marketData.filter((c) => c?.symbol);
  if (!items.length && !funding) return null;

  const still = prefs.reduceMotion === true || prefersReducedMotion();
  const secs = Math.max(20, items.length * (SECONDS_PER_ITEM[prefs.tickerSpeed] || SECONDS_PER_ITEM.normal));

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-slate-800/80 bg-[#070b14] px-3 text-xs" data-testid="ticker-bar">
      <div className="tm-marquee-wrap hide-scrollbar min-w-0 flex-1 overflow-hidden" role="group" aria-label="Ticker: 24h price change">
        {still ? (
          <div className="hide-scrollbar flex items-center gap-5 overflow-x-auto">
            {items.map((c) => <Item key={c.id || c.symbol} c={c} focusable />)}
          </div>
        ) : (
          <div className="tm-marquee flex w-max items-center" style={{ '--tm-marquee-s': `${secs}s` }}>
            <div className="flex shrink-0 items-center gap-5 pr-5">{items.map((c) => <Item key={c.id || c.symbol} c={c} focusable />)}</div>
            <div className="flex shrink-0 items-center gap-5 pr-5" aria-hidden="true">{items.map((c) => <Item key={c.id || c.symbol} c={c} />)}</div>
          </div>
        )}
      </div>
      {funding && (
        <span title={FUNDING_TIP} className="shrink-0 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-0.5 tabular-nums text-slate-400">
          Next funding in <span className="text-slate-200">{fmtCountdown(left)}</span>
        </span>
      )}
    </div>
  );
};

export default TickerBar;
