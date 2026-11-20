import React, { useMemo } from 'react';
import { Notice, Panel, coin } from '../liquidation/shared';
import Skeleton from '../ui/Skeleton';

const SCALE = 0.0005; // +-0.05% per interval saturates the colour

// Diverging: emerald (longs pay) / rose (shorts pay), faint near zero.
const FundingStrip = ({ rows, error, selected, onSelect }) => {
  const top = useMemo(
    () => [...(rows || [])].filter((r) => Number.isFinite(r.fundingRate)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 20),
    [rows],
  );
  return (
    <Panel title="Funding heatmap, top 20 by volume" right={<span className="text-[11px] text-slate-500">green: longs pay, red: shorts pay</span>}>
      {!rows && error ? <Notice tone="error">Funding data unavailable, retrying.</Notice> : !rows ? (
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-5 lg:grid-cols-10" aria-busy="true">
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-[46px]" />)}
        </div>
      ) : top.length === 0 ? <Notice>No funding data yet.</Notice> : (
        <div className="grid grid-cols-4 gap-1 sm:grid-cols-5 lg:grid-cols-10">
          {top.map((r) => {
            const a = Math.min(1, Math.abs(r.fundingRate) / SCALE);
            const rgb = r.fundingRate >= 0 ? '52, 211, 153' : '251, 113, 133';
            return (
              <button
                key={r.symbol}
                type="button"
                onClick={() => onSelect(r.symbol)}
                aria-pressed={r.symbol === selected}
                title={`${coin(r.symbol)} funding ${(r.fundingRate * 100).toFixed(4)}%`}
                className={`rounded-md px-1 py-1.5 text-center text-[11px] leading-tight text-slate-100 ${r.symbol === selected ? 'ring-2 ring-cyan-400' : ''}`}
                style={{ backgroundColor: `rgba(${rgb}, ${0.1 + 0.6 * a})` }}
              >
                <span className="block font-semibold">{coin(r.symbol)}</span>
                <span className="block tabular-nums">{(r.fundingRate * 100).toFixed(3)}%</span>
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
};

export default FundingStrip;
