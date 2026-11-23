import React from 'react';
import Panel from '../ui/Panel';
import { fmtMarketPrice, fmtQty } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';

const time = (ts) => new Date(ts).toLocaleTimeString([], { hour12: false });

const TradesTapePanel = ({ trades, loading, className = '' }) => (
  <Panel title="Trades" className={className} bodyClassName="relative min-h-[220px] xl:min-h-0 p-0">
    {trades.length === 0 ? (
      loading ? (
        <div className="space-y-1.5 px-3 pt-2" aria-busy="true" aria-label="Loading trades">
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-3 w-full" />)}
        </div>
      ) : <p className="px-3 pt-2 text-xs text-slate-500">Waiting for trades…</p>
    ) : (
      <div className="absolute inset-0 overflow-y-auto pb-1.5">
        <div className="sticky top-0 grid grid-cols-3 bg-slate-950 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-500">
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Time</span>
        </div>
        {trades.map((t, i) => (
          <div key={i} className="grid grid-cols-3 px-3 py-px text-xs tabular-nums">
            <span className={t.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}>
              <span aria-hidden="true">{t.side === 'buy' ? '▲' : '▼'} </span><span className="sr-only">{t.side === 'buy' ? 'buy' : 'sell'} </span>{fmtMarketPrice(t.price)}
            </span>
            <span className="text-right text-slate-300">{fmtQty(t.qty)}</span>
            <span className="text-right text-slate-500">{time(t.ts)}</span>
          </div>
        ))}
      </div>
    )}
  </Panel>
);

export default TradesTapePanel;
