import React from 'react';
import useStrategyStore from '../../store/strategyStore';

// Chart footer chip for the strategy overlay. `chip` comes from useStrategyOverlay (null = nothing to show).
const StrategyChip = ({ chip }) => {
  if (!chip) return null;
  const all = chip.mode === 'all';
  return (
    <div role="status" aria-label="Strategy overlay" className="rounded-md border border-slate-700 bg-slate-950/90 px-2 py-1 text-[11px] text-slate-300 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <b className="text-cyan-300">{chip.name}</b>
        <span className="text-slate-400">{all ? 'Applied on all timeframes' : `Pinned to ${chip.designedOn}`}</span>
        {chip.mismatch ? <span className="text-amber-300">{chip.mismatch}</span> : chip.unavailable ? (
          <span className="text-amber-300">Not available on this timeframe ({chip.interval})</span>
        ) : (
          <span className="tabular-nums">
            {chip.pending ? `Evaluating on ${chip.interval}…` : `${chip.trades} trades on ${chip.interval}${chip.winRate != null ? `, win ${Math.round(chip.winRate)}%` : ''}`}
            {chip.loading && !chip.pending ? ', updating…' : ''}
          </span>
        )}
        {chip.error && <span className="text-rose-300">{chip.error}</span>}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={all} onChange={(e) => useStrategyStore.getState().setAllTimeframes(e.target.checked)} />
          All timeframes
        </label>
        <button type="button" onClick={() => useStrategyStore.getState().clear()} className="focus-ring rounded border border-slate-700 px-1.5 text-slate-200 hover:bg-slate-800">Clear</button>
      </div>
      <div className="text-amber-200/80">Backtest is hypothetical and likely overfit; results differ by timeframe</div>
    </div>
  );
};

export default StrategyChip;
