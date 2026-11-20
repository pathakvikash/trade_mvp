import React, { useEffect, useMemo, useState } from 'react';
import usePersistedState from '../../lib/usePersistedState';
import { Notice, Panel, SortTh, coin, fmtPct, fmtPrice, fmtUsd, useSort } from '../liquidation/shared';
import { fmtCountdown } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';

const getters = {
  symbol: (r) => r.symbol,
  price: (r) => r.lastPrice,
  chg: (r) => r.priceChangePercent,
  funding: (r) => r.fundingRate,
  next: (r) => r.nextFundingTime,
  oi: (r) => r.openInterestUsd,
  vol: (r) => r.quoteVolume,
};

const cls = (v) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400');

const MarketTable = ({ rows, error, selected, onSelect }) => {
  const [q, setQ] = usePersistedState('derivatives.search', '', { validate: (v) => typeof v === 'string' && v.length <= 40 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (rows || []).filter((r) => r.symbol.includes(t));
  }, [rows, q]);
  const { sorted, sort, toggle } = useSort(filtered, getters, 'vol', 'desc', 'derivatives.table');

  return (
    <Panel
      title="Perpetual futures market"
      right={<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter symbol" aria-label="Filter symbols" className="w-36 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-400 focus:outline-none" />}
    >
      {!rows && error ? <Notice tone="error">Market data unavailable, retrying.</Notice> : !rows ? (
        <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading market table">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex justify-between gap-3">
              {[0, 1, 2, 3, 4, 5, 6].map((j) => <Skeleton key={j} className="h-3 flex-1" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[640px] text-xs tabular-nums">
            <thead className="sticky top-0 bg-slate-950 text-[11px] text-slate-500">
              <tr>
                <SortTh k="symbol" sort={sort} toggle={toggle} left>Symbol</SortTh>
                <SortTh k="price" sort={sort} toggle={toggle}>Price</SortTh>
                <SortTh k="chg" sort={sort} toggle={toggle}>24h</SortTh>
                <SortTh k="funding" sort={sort} toggle={toggle}>Funding (APR)</SortTh>
                <SortTh k="next" sort={sort} toggle={toggle}>Next</SortTh>
                <SortTh k="oi" sort={sort} toggle={toggle}>Open interest</SortTh>
                <SortTh k="vol" sort={sort} toggle={toggle}>24h volume</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 150).map((r) => (
                <tr
                  key={r.symbol}
                  tabIndex={0}
                  aria-selected={r.symbol === selected}
                  onClick={() => onSelect(r.symbol)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.symbol); } }}
                  className={`cursor-pointer border-t border-slate-800/60 hover:bg-slate-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${r.symbol === selected ? 'bg-cyan-400/10' : ''}`}
                >
                  <td className="px-2 py-1 font-medium text-slate-200">{coin(r.symbol)}</td>
                  <td className="px-2 py-1 text-right text-slate-200">{fmtPrice(r.lastPrice)}</td>
                  <td className={`px-2 py-1 text-right ${cls(r.priceChangePercent)}`}>{fmtPct(r.priceChangePercent)}</td>
                  <td className={`px-2 py-1 text-right ${cls(r.fundingRate)}`}>
                    {Number.isFinite(r.fundingRate) ? `${(r.fundingRate * 100).toFixed(4)}%` : '--'}
                    <span className="text-slate-500"> ({Number.isFinite(r.fundingRate) ? `${(r.fundingRate * (24 / (r.fundingIntervalHours || 8)) * 365 * 100).toFixed(1)}%` : '--'})</span>
                  </td>
                  <td className="px-2 py-1 text-right text-slate-400">{fmtCountdown(r.nextFundingTime - now)}{r.fundingIntervalHours ? <span className="text-slate-500"> ({r.fundingIntervalHours}h)</span> : null}</td>
                  <td className="px-2 py-1 text-right text-slate-200">{fmtUsd(r.openInterestUsd)}</td>
                  <td className="px-2 py-1 text-right text-slate-400">{fmtUsd(r.quoteVolume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && <Notice>No symbols match.</Notice>}
        </div>
      )}
      <p className="mt-1 text-[11px] text-slate-500">APR = rate x payments per day (24 / funding interval) x 365, simple, not compounded. The interval is shown next to the countdown.</p>
    </Panel>
  );
};

export default MarketTable;
