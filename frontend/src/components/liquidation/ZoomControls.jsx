import React from 'react';
import { MAX_K, MIN_K, STEP, fmtZoom } from './zoomView';

const btn = 'focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-slate-700 px-2 text-xs text-slate-300 hover:text-slate-100 disabled:opacity-40 sm:min-h-0 sm:min-w-0 sm:py-0.5';

// Zoom -, level, +, Reset. Always rendered (fixed width) so zooming never shifts the layout.
const ZoomControls = ({ k, onZoom, onReset, label = 'chart' }) => (
  <div role="group" aria-label={`Zoom ${label}`} className="inline-flex items-center gap-1">
    <button type="button" className={btn} aria-label={`Zoom out ${label}`} disabled={k <= MIN_K} onClick={() => onZoom(1 / STEP)}>−</button>
    <span data-testid="zoom-level" className="inline-block w-9 text-center text-[11px] tabular-nums text-slate-400" title="Ctrl/Cmd+wheel or pinch to zoom, drag to pan, double-click to reset">{fmtZoom(k)}</span>
    <button type="button" className={btn} aria-label={`Zoom in ${label}`} disabled={k >= MAX_K} onClick={() => onZoom(STEP)}>+</button>
    <button type="button" className={btn} aria-label={`Reset zoom ${label}`} disabled={k <= MIN_K} onClick={onReset}>Reset</button>
  </div>
);

export default ZoomControls;
