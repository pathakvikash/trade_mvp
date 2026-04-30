import React from 'react';
import Card from '../ui/Card';

const OrderBookPanel = ({ bids, asks, spread }) => {
  return (
    <Card className="h-full">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Order Book</p>
          <h3 className="mt-1 text-lg font-semibold text-white">Level 2 liquidity</h3>
        </div>
        <div className="rounded-2xl bg-slate-900/80 px-3 py-2 text-sm text-slate-300">
          Spread <span className="font-semibold text-white">{spread}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-3xl bg-slate-900/70 p-3 text-xs uppercase tracking-[0.24em] text-slate-400">Asks</div>
          <div className="space-y-2">
            {asks.map((ask) => (
              <div key={ask.price} className="grid grid-cols-3 gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                <span className="text-red-400">{ask.price}</span>
                <span className="text-slate-400">{ask.size}</span>
                <span className="text-slate-500">{ask.total}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-3xl bg-slate-900/70 p-3 text-xs uppercase tracking-[0.24em] text-slate-400">Bids</div>
          <div className="space-y-2">
            {bids.map((bid) => (
              <div key={bid.price} className="grid grid-cols-3 gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-sm text-slate-100">
                <span className="text-emerald-400">{bid.price}</span>
                <span className="text-slate-400">{bid.size}</span>
                <span className="text-slate-500">{bid.total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
};

export default OrderBookPanel;
