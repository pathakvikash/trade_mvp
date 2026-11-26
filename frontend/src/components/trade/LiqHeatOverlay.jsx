import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import usePersistedState from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import SegTabs from '../ui/SegTabs';
import { Tip, placeFixed, useDismiss } from '../ui/Tooltip';
import { PARTIAL_NOTE, sourceNote } from '../ui/sourceNote';
import { PALETTES, rampCss } from '../liquidation/heat';
import useHeatView, { LENSES } from '../liquidation/heatView';
import { FUT } from '../liquidation/shared';

export const CAPTION = 'Liquidation heatmap: estimate from open-interest changes, not exchange data';
export const RANGES = ['12h', '24h', '3d', '1w'].map((id) => ({ id, label: id }));
// Shared with the Liquidation page (same persisted keys, so a change on either page shows on the other, live in the same tab):
//   range  'liquidation.heatRange'  (inline in components/liquidation/LiqHeat.jsx, duplicated here; ponytail: keep in step)
//   lens / palette / intensity  'liquidation.heatLens' / '.heatPalette' / '.heatIntensity'  (via useHeatView, imported read-only from heatView.js)
// Overlay-only keys: 'chart.liqHeat' (on/off) and 'chart.liqHeatOpacity' (percent).
export const HEAT_RANGE_KEY = 'liquidation.heatRange';

// State + data for the heat behind the candles. `available` = a futures symbol with a market; otherwise nothing is fetched or shown.
export default function useLiqHeatOverlay(symbol, available) {
  const [on, setOn] = usePersistedState('chart.liqHeat', false, { validate: (v) => typeof v === 'boolean' });
  const [opacity, setOpacity] = usePersistedState('chart.liqHeatOpacity', 50, { validate: (v) => Number.isInteger(v) && v >= 10 && v <= 90 });
  const [range, setRange] = usePersistedState(HEAT_RANGE_KEY, '24h', { validate: (v) => RANGES.some((r) => r.id === v) });
  const view = useHeatView();
  const active = on && available && !!symbol;
  const { data, error, loading, source } = usePolling(active ? `${FUT}/liqheat/${symbol}?range=${range}` : null, 60000);
  const ok = active && !!data && data.cols > 0 && data.candles?.length > 0;
  return {
    on, setOn, opacity, setOpacity, range, setRange, view, available, active, data, error, loading, source, ok,
    // CandleChart prop: absent unless there is real data
    heat: ok ? { data, palette: view.palette, lens: view.lens, intensity: view.intensity, opacity: opacity / 100 } : undefined,
  };
}

const field = 'focus-ring rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 min-h-[44px] sm:min-h-0';

// Settings popover: portalled and fixed so no overflow container clips it.
const Settings = ({ h }) => {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  const close = useCallback(() => { setOpen(false); btn.current?.focus({ preventScroll: true }); }, []);
  useDismiss(open, close, btn);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useLayoutEffect(() => { if (open && pop.current && btn.current) placeFixed(pop.current, btn.current.getBoundingClientRect(), { prefer: 'below', align: 'end' }); }, [open]);
  const { palette, setPalette, lens, setLens, intensity, setIntensity } = h.view;
  const [lo, hi] = intensity;
  return (
    <>
      <button ref={btn} type="button" aria-expanded={open} aria-haspopup="true" aria-label="Heatmap settings" onClick={() => setOpen((o) => !o)} className={`${field} hover:border-slate-500`}>Heat settings</button>
      {open && createPortal(
        <div ref={pop} role="group" aria-label="Heatmap settings" style={{ left: 0, top: 0, visibility: 'hidden' }} className="fixed z-40 w-64 max-w-[calc(100vw-8px)] space-y-2 rounded-md border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300 shadow-lg">
          <label className="flex items-center justify-between gap-2">Opacity {h.opacity}%
            <input type="range" min="10" max="90" step="5" value={h.opacity} aria-label="Heatmap opacity" onChange={(e) => h.setOpacity(+e.target.value)} className="w-28 accent-cyan-400" />
          </label>
          <div className="flex items-center justify-between gap-2">Range
            <SegTabs label="Heatmap range" tabs={RANGES} active={h.range} onChange={h.setRange} className="[&_button]:min-h-[44px] sm:[&_button]:min-h-0" />
          </div>
          <label className="flex items-center justify-between gap-2">Colours
            <i aria-hidden="true" className="inline-block h-2 w-8 rounded-sm" style={{ background: rampCss(palette) }} />
            <select value={palette} onChange={(e) => setPalette(e.target.value)} className={field}>{PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          </label>
          <label className="flex items-center justify-between gap-2">Lens
            <select value={lens} onChange={(e) => setLens(e.target.value)} className={field}>{LENSES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
          </label>
          <div className="flex items-center justify-between gap-2">Intensity
            <span className="inline-flex gap-1">
              <input type="range" min="0" max="99" value={lo} aria-label="Intensity minimum, percent of largest cell" onChange={(e) => setIntensity([Math.min(+e.target.value, hi - 1), hi])} className="w-16 accent-cyan-400" />
              <input type="range" min="1" max="100" value={hi} aria-label="Intensity maximum, percent of largest cell" onChange={(e) => setIntensity([lo, Math.max(+e.target.value, lo + 1)])} className="w-16 accent-cyan-400" />
            </span>
          </div>
          <p className="text-[10px] text-slate-500">Range, colours, lens and intensity are shared with the Liquidation page.</p>
        </div>,
        document.body,
      )}
    </>
  );
};

// Toggle + settings + caption for the panel header. Renders nothing without a futures symbol.
export const LiqHeatControls = ({ h }) => {
  if (!h.available) return null;
  return (
    <>
      <Tip text={CAPTION}>
        <button type="button" aria-pressed={h.on} onClick={() => h.setOn(!h.on)} className={`focus-ring min-h-[44px] rounded-md border px-2 py-1 text-xs font-medium sm:min-h-0 ${h.on ? 'border-cyan-400/60 text-cyan-300' : 'border-slate-700 text-slate-300 hover:bg-slate-900'}`}>Liq heatmap</button>
      </Tip>
      {h.on && <Settings h={h} />}
      <span data-testid="heat-caption" className="basis-full text-right text-[10px] text-slate-500">{CAPTION}</span>
    </>
  );
};

// Status line over the chart while the overlay is on: loading / unavailable / source / partial. Never fake data.
export const LiqHeatChip = ({ h }) => {
  if (!h.active) return null;
  const note = sourceNote(h.source, 'heatmap');
  let text = null;
  if (h.error && !h.ok) text = 'Liquidation heatmap unavailable';
  else if (h.loading) text = 'Loading liquidation heatmap…';
  else if (h.ok) text = [h.error ? 'Heatmap may be stale (refresh failed)' : '', h.data.partial ? PARTIAL_NOTE : '', note].filter(Boolean).join(' · ');
  if (!text) return null;
  return <div role="status" className="pointer-events-none absolute bottom-8 left-2 z-10 max-w-[calc(100%-5rem)] text-[10px] text-amber-400">{text}</div>;
};
