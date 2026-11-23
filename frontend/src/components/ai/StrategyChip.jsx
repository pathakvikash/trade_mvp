import React from 'react';
import useStrategyStore from '../../store/strategyStore';

// Chart footer chip for the strategy overlay. `chip` comes from useStrategyOverlay (null = nothing to show).
const StrategyChip = ({ chip }) => {
  if (!chip) return null;
  return (
    <div role="status" aria-label="Strategy overlay" className="rounded-md border border-slate-700 bg-slate-950/90 px-2 py-1 text-[11px] text-slate-300 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <b className="text-cyan-300">{chip.name}</b>
        {chip.mismatch ? <span className="text-amber-300">{chip.mismatch}</span> : (
          <span className="tabular-nums">
            {chip.trades} trades{chip.winRate != null ? `, win ${Math.round(chip.winRate)}%` : ''}
            {chip.loading ? ', updating…' : ''}
          </span>
        )}
        {chip.error && <span className="text-rose-300">{chip.error}</span>}
        <button type="button" onClick={() => useStrategyStore.getState().clear()} className="focus-ring rounded border border-slate-700 px-1.5 text-slate-200 hover:bg-slate-800">Clear</button>
      </div>
      <div className="text-amber-200/80">Backtest is hypothetical and likely overfit</div>
    </div>
  );
};

export default StrategyChip;
