import React from 'react';
import { fmtPrice, fmtQty } from '../ui/fmt';
import { money, pnlCls } from './PositionsTable';

const REASON = { manual: 'Closed', tp: 'Take profit', sl: 'Stop loss', liquidation: 'Liquidated' };

// Closed futures positions (last 20 from the server): reason, exit, realised P/L and fees. Liquidated rows are flagged.
const FuturesHistory = ({ closed = [] }) => {
  if (!closed.length) return null;
  return (
    <div className="mb-3 text-xs tabular-nums">
      <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">Futures</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-slate-300">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              {['Position', 'Reason', 'Exit', 'Realised P/L', 'Fees'].map((h, i) => <th key={h} className={`pb-1 font-normal ${i > 1 ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {closed.map((p) => {
              const liq = p.closeReason === 'liquidation' || p.status === 'liquidated';
              return (
                <tr key={p._id} className={liq ? 'bg-rose-500/10' : ''}>
                  <td className="py-1">
                    <span className={p.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}>{p.side === 'long' ? 'Long' : 'Short'} {p.leverage}x</span>{' '}
                    <span className="text-slate-200">{p.symbol}</span>{' '}
                    <span className="text-slate-500">{fmtQty(p.size)}</span>
                  </td>
                  <td className={liq ? 'font-semibold text-rose-400' : 'text-slate-400'}>{REASON[p.closeReason] || (liq ? 'Liquidated' : 'Closed')}</td>
                  <td className="text-right">{p.exitPrice ? fmtPrice(p.exitPrice) : '--'}</td>
                  <td className={`text-right ${pnlCls(p.realizedPnl)}`}>{money(p.realizedPnl || 0)}</td>
                  <td className="text-right text-slate-500">${fmtPrice(p.fees || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FuturesHistory;
