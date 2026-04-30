import React from 'react';
import Card from '../ui/Card';

const PositionsPanel = ({ positions }) => {
  return (
    <Card>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Open Positions</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Active margin positions</h3>
        </div>
      </div>
      <div className="space-y-3">
        {positions.map((position) => (
          <div key={position.symbol} className="grid gap-3 rounded-3xl border border-slate-800 bg-slate-950/85 p-4 sm:grid-cols-[1.25fr_1fr_1fr]">
            <div>
              <p className="text-sm text-slate-400">{position.symbol}</p>
              <p className="mt-1 text-white">{position.description}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-slate-400">Size</p>
              <p className="text-white">{position.size}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-sm text-slate-400">P&L</p>
              <p className={position.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>{position.pnl >= 0 ? '+' : ''}${position.pnl.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

export default PositionsPanel;
