import React, { useMemo } from 'react';
import { spotEntryFromTrades } from '../../lib/chartLines';
import { fmtPrice, fmtQty, fmtPct } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';

const sign = (v) => `${v >= 0 ? '+' : '-'}$${fmtPrice(Math.round(Math.abs(v) * 100) / 100)}`;

// Spot holdings with average entry (from trade history, falling back to the server's avgCost), live price and P/L.
const SpotHoldings = ({ holdings = [], trades = [], prices = {}, loading = false }) => {
  const rows = useMemo(() => holdings.map((h) => {
    const entry = spotEntryFromTrades(trades, h.symbol)?.avgEntry ?? h.avgCost;
    const px = prices[h.symbol];
    const has = Number.isFinite(px) && entry > 0;
    return {
      symbol: h.symbol, amount: h.amount, entry, px: Number.isFinite(px) ? px : null,
      value: Number.isFinite(px) ? h.amount * px : null,
      pnl: has ? (px - entry) * h.amount : null,
      pct: has ? ((px - entry) / entry) * 100 : null,
    };
  }), [holdings, trades, prices]);
  if (loading) return <div aria-busy="true" aria-label="Loading spot holdings"><Skeleton className="h-4 w-full" /></div>;
  return (
    <div className="mt-3 border-t border-slate-800/60 pt-2 text-xs tabular-nums">
      <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">Spot holdings{rows.length > 0 && <span className="ml-1 text-slate-400" data-testid="spot-count">({rows.length})</span>}</h3>
      {rows.length === 0 ? <div className="py-1 text-slate-500">No spot holdings</div> : (
        <div className="overflow-x-auto">
          <table aria-label="Spot holdings" className="w-full min-w-[460px] text-slate-300">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                {['Coin', 'Amount', 'Avg entry', 'Price', 'Value', 'P/L'].map((h, i) => <th key={h} scope="col" className={`pb-1 font-normal ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.symbol}>
                  <td className="py-1 font-medium text-slate-200">{r.symbol}</td>
                  <td className="text-right">{fmtQty(r.amount)}</td>
                  <td className="text-right">{fmtPrice(r.entry)}</td>
                  <td className="text-right">{r.px === null ? '--' : fmtPrice(r.px)}</td>
                  <td className="text-right">{r.value === null ? '--' : `$${fmtPrice(r.value)}`}</td>
                  <td className={`text-right ${r.pnl === null ? 'text-slate-500' : r.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {r.pnl === null ? '--' : `${sign(r.pnl)} (${fmtPct(r.pct, 1)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SpotHoldings;
