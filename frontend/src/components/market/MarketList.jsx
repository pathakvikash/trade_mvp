import React, { useMemo } from 'react';
import usePersistedState from '../../lib/usePersistedState';
import Panel from '../ui/Panel';
import { SortTh, coin, useSort } from '../liquidation/shared';
import { fmtPct, fmtPrice, fmtUsd } from '../ui/fmt';

const fundingPct = (r) => (r.fundingRate == null ? null : r.fundingRate * 100);

const getters = {
  symbol: (r) => coin(r.symbol),
  price: (r) => r.lastPrice,
  chg: (r) => r.priceChangePercent,
  vol: (r) => r.quoteVolume,
  funding: fundingPct,
};

const tone = (v) => (v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-slate-400');

const Skeleton = () => Array.from({ length: 8 }, (_, i) => (
  <tr key={i} className="border-t border-slate-800/60">
    <td colSpan={5} className="px-2 py-2"><div className="h-3 animate-pulse rounded bg-slate-800/70" /></td>
  </tr>
));

// Left column of the Markets page: search, sortable columns, click a row to select it.
const MarketList = ({ rows, error, onRetry, selected, onSelect, className = '' }) => {
  const [q, setQ] = usePersistedState('market.search', '', { validate: (v) => typeof v === 'string' && v.length <= 40 });
  const filtered = useMemo(() => {
    const t = q.trim().toUpperCase();
    return (rows || []).filter((r) => r.symbol.includes(t));
  }, [rows, q]);
  const { sorted, sort, toggle } = useSort(filtered, getters, 'vol', 'desc', 'market.list');

  return (
    <Panel
      title="Markets"
      className={className}
      bodyClassName="min-h-0 p-0"
      right={
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          aria-label="Search markets"
          className="focus-ring w-28 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 placeholder-slate-500"
        />
      }
    >
      {!rows && error ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-sm text-rose-300">
          <span>Market data unavailable.</span>
          <button type="button" onClick={onRetry} className="focus-ring rounded-md border border-rose-300/40 px-2 py-0.5 text-xs hover:bg-rose-300/10">Retry</button>
        </div>
      ) : (
        <div className="max-h-[28rem] overflow-auto xl:h-full xl:max-h-none">
          <table className="w-full min-w-[340px] text-xs tabular-nums">
            <thead className="sticky top-0 z-[1] bg-slate-950 text-[11px] text-slate-500">
              <tr>
                <SortTh k="symbol" sort={sort} toggle={toggle} left>Market</SortTh>
                <SortTh k="price" sort={sort} toggle={toggle}>Last</SortTh>
                <SortTh k="chg" sort={sort} toggle={toggle}>24h</SortTh>
                <SortTh k="vol" sort={sort} toggle={toggle}>Volume</SortTh>
                <SortTh k="funding" sort={sort} toggle={toggle}>Funding</SortTh>
              </tr>
            </thead>
            <tbody>
              {!rows ? <Skeleton /> : sorted.map((r) => {
                const active = r.symbol === selected;
                return (
                  <tr
                    key={r.symbol}
                    tabIndex={0}
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(r.symbol)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.symbol); } }}
                    className={`cursor-pointer border-t border-slate-800/60 hover:bg-slate-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${active ? 'bg-cyan-400/10 shadow-[inset_2px_0_0_0_#22d3ee]' : ''}`}
                  >
                    <td className="px-2 py-1.5 font-medium text-slate-200">{coin(r.symbol)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-200">{fmtPrice(r.lastPrice)}</td>
                    <td className={`px-2 py-1.5 text-right ${tone(r.priceChangePercent)}`}>{fmtPct(r.priceChangePercent)}</td>
                    <td className="px-2 py-1.5 text-right text-slate-400">{fmtUsd(r.quoteVolume)}</td>
                    <td className={`px-2 py-1.5 text-right ${tone(r.fundingRate)}`}>{fmtPct(fundingPct(r), 4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows && sorted.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">{q.trim() ? 'No matches' : 'No markets available'}</p>
          )}
        </div>
      )}
    </Panel>
  );
};

export default MarketList;
