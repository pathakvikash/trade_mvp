import React, { useState } from 'react';
import { useEscLayer } from '../ui/escLayers';
import { rampCss } from './heat';
import useHeatView, { LENSES } from './heatView';
import { fmtUsd } from './shared';

// Floating legend toggle. The scale follows the heatmap's persisted palette, lens and intensity clamp (same stored
// settings as the controls), so it always matches what is drawn. `max` = largest cell in USD (omit while loading).
// z-30: under the AI dock (z-50) and the nav overlay (z-40). The page keeps bottom padding so it never hides the last rows.
const LegendFab = ({ max }) => {
  const [open, setOpen] = useState(false);
  const { palette, lens, intensity: [lo, hi] } = useHeatView();
  useEscLayer(open, () => setOpen(false));
  const known = Number.isFinite(max) && max > 0;
  return (
    <div className="fixed bottom-4 right-4 z-30 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
      {open && (
        <div id="liq-legend" role="region" aria-label="Heatmap legend" className="w-72 max-w-full rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-xs leading-relaxed text-slate-300 shadow-lg">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-100">Legend</h3>
            <button type="button" aria-label="Close legend" onClick={() => setOpen(false)} className="focus-ring rounded px-1.5 text-slate-400 hover:text-slate-100">✕</button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">Predicted heatmap colour, estimated liquidation USD per cell ({LENSES.find((l) => l.id === lens)?.label || 'Heat'} lens)</p>
          <i data-testid="legend-ramp" data-palette={palette} aria-hidden="true" className="mt-1 block h-2.5 w-full rounded-sm" style={{ background: rampCss(palette) }} />
          <div className="mt-0.5 flex justify-between tabular-nums text-[11px]">
            <span>{known ? `${fmtUsd((max * lo) / 100)} (${lo}%)` : `${lo}%`}</span>
            <span>{known ? `${fmtUsd((max * hi) / 100)} (${hi}%)` : `${hi}%`}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Linear between the intensity limits; lower cells are not drawn, higher ones take the top colour. Cells above that column's closing price are short levels, below are long levels.</p>
          <ul className="mt-2 space-y-1">
            <li><i aria-hidden="true" className="mr-1.5 inline-block h-0 w-5 border-t border-dashed border-slate-100 align-middle" />Current price (dashed line and axis tag)</li>
            <li><i aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 align-middle" style={{ background: '#10b981' }} />Up candle <i aria-hidden="true" className="ml-2 mr-1.5 inline-block h-2 w-2 align-middle" style={{ background: '#ef4444' }} />Down candle</li>
            <li>
              <span aria-hidden="true" className="mr-1.5 inline-flex h-2.5 w-5 overflow-hidden rounded-sm align-middle"><i className="w-1/2 bg-emerald-400" /><i className="w-1/2 bg-rose-400" /></span>
              Realized view cell: left half = longs liquidated, right half = shorts liquidated
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-amber-400">Predicted heatmap and map are model estimates. Realized liquidations and the feed are sampled: real totals are higher.</p>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="liq-legend"
        onClick={() => setOpen((o) => !o)}
        className="focus-ring h-10 rounded-full border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 shadow-lg hover:border-slate-500"
      >
        Legend
      </button>
    </div>
  );
};

export default LegendFab;
