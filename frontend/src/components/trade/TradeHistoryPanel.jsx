import React from 'react';
import Card from '../ui/Card';

const TradeHistoryPanel = ({ trades }) => {
  return (
    <Card>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Trade History</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Recent fills</h3>
        </div>
      </div>
      <div className="space-y-3">
        {trades.map((trade) => (
          <div key={trade.id} className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/85 p-4 sm:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <p className="text-sm text-slate-400">{trade.symbol}</p>
              <p className="mt-1 text-white">{trade.action} · {trade.amount} {trade.asset}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Price</p>
              <p className="mt-1 text-white">${trade.price.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-400">Time</p>
              <p className="mt-1 text-white">{trade.time}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default TradeHistoryPanel;
