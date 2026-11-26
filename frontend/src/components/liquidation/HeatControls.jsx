import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeFixed, useDismiss } from '../ui/Tooltip';
import { PALETTES, rampCss } from './heat';
import { DISPLAY_ITEMS, LENSES } from './heatView';
import { fmtUsd } from './shared';

const field = 'focus-ring rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200';

// Display menu: a button with a checkbox list. The panel is portalled and fixed (placeFixed clamps it to the viewport), so
// overflow containers and the sidebar cannot clip it; z-40 sits above the heatmap and below the AgentDock (z-50).
// Opening focuses the first checkbox; Esc, scroll and resize close it and return focus to the button; an outside press just closes.
const DisplayMenu = ({ display, onDisplay }) => {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  const close = useCallback(() => { setOpen(false); btn.current?.focus({ preventScroll: true }); }, []);
  useDismiss(open, close, btn);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('mousedown', onDown); };
  }, [open]);
  useLayoutEffect(() => { if (open && pop.current && btn.current) placeFixed(pop.current, btn.current.getBoundingClientRect(), { prefer: 'below', align: 'start' }); }, [open]);
  useEffect(() => { if (open) pop.current?.querySelector('input')?.focus({ preventScroll: true }); }, [open]);
  return (
    <>
      <button ref={btn} type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} className={`${field} hover:border-slate-500`}>Display</button>
      {open && createPortal(
        <div ref={pop} role="group" aria-label="Display" style={{ left: 0, top: 0, visibility: 'hidden' }} className="fixed z-40 w-48 max-w-[calc(100vw-8px)] rounded-md border border-slate-700 bg-slate-950 p-2 shadow-lg">
          {DISPLAY_ITEMS.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs text-slate-200 hover:bg-slate-800">
              <input type="checkbox" checked={!!display?.[it.id]} onChange={(e) => onDisplay({ ...display, [it.id]: e.target.checked })} className="accent-cyan-400" />
              {it.label}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};

// Second toolbar row of the heatmap. intensity = [lo, hi] in percent of the largest cell; max = that cell in USD.
const HeatControls = ({ lens, onLens, palette, onPalette, intensity, onIntensity, max, display, onDisplay, className = '' }) => {
  const [lo, hi] = intensity || [0, 100];
  return (
    <div role="group" aria-label="Heatmap controls" className={`mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400 ${className}`}>
      <label className="inline-flex items-center gap-1.5">Lens
        <select value={lens} onChange={(e) => onLens(e.target.value)} className={field}>
          {LENSES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <label className="inline-flex items-center gap-1.5">Colours
        <i aria-hidden="true" className="inline-block h-2 w-10 rounded-sm" style={{ background: rampCss(palette) }} />
        <select value={palette} onChange={(e) => onPalette(e.target.value)} className={field}>
          {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span id="heat-intensity-h">Intensity</span>
        <span role="group" aria-labelledby="heat-intensity-h" className="inline-flex items-center gap-1">
          <input type="range" min="0" max="99" value={lo} aria-label="Intensity minimum, percent of largest cell" onChange={(e) => onIntensity([Math.min(+e.target.value, hi - 1), hi])} className="w-20 accent-cyan-400" />
          <input type="range" min="1" max="100" value={hi} aria-label="Intensity maximum, percent of largest cell" onChange={(e) => onIntensity([lo, Math.max(+e.target.value, lo + 1)])} className="w-20 accent-cyan-400" />
        </span>
        <span data-testid="intensity-readout" className="tabular-nums">≥ {lo}% · {fmtUsd((max * lo) / 100)} — ≤ {hi}% · {fmtUsd((max * hi) / 100)}</span>
      </span>
      {display && <DisplayMenu display={display} onDisplay={onDisplay} />}
    </div>
  );
};

export default HeatControls;
