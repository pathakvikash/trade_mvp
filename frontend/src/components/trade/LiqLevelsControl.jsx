import React from 'react';
import { Tip } from '../ui/Tooltip';
import { sourceNote } from '../ui/sourceNote';

const TIP = 'Estimated liquidation levels from open interest; an estimate, not exchange data';

export const LiqToggle = ({ on, onToggle }) => (
  <Tip text={TIP}>
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`focus-ring rounded-md border px-2 py-1 text-xs font-medium min-h-[36px] sm:min-h-0 ${
        on ? 'border-cyan-400/60 text-cyan-300' : 'border-slate-700 text-slate-300 hover:bg-slate-900'
      }`}
    >
      Liq levels
    </button>
  </Tip>
);

// Small status chip over the chart while the overlay is on. Never an error page.
export const LiqChip = ({ liq }) => {
  const note = liq.source && liq.source !== 'binance-futures' ? sourceNote(liq.source, 'heatmap') : '';
  let text;
  if (liq.error) text = 'Liquidation map unavailable';
  else if (liq.loading) text = 'Loading liquidation levels…';
  else text = `Est. liq levels · estimated model${liq.source ? ` · source: ${liq.source}` : ''}`;
  return (
    <div className="pointer-events-none absolute left-2 top-5 z-10 max-w-[calc(100%-5rem)] text-[10px] text-slate-500" role="status">
      {text}{note && <span className="hidden sm:inline"> · {note}</span>}
    </div>
  );
};
