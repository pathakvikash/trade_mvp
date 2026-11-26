import React from 'react';
import SegTabs from '../ui/SegTabs';
import { Icon } from '../ui/IconButton';
import { Tip } from '../ui/Tooltip';
import ZoomControls from './ZoomControls';
import ObhMenu, { field } from './ObhMenu';
import { PALETTES, rampCss } from './heat';
import { BANDS, GRIDS, LAYERS, SUBPANES, UNITS, fmtUnit } from './obh';
import { fmtMarketPrice } from './shared';

const iconBtn = 'focus-ring inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 sm:h-7 sm:min-h-0 sm:min-w-[1.75rem]';
const Cam = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" /></svg>
);
const Btn = ({ label, onClick, children, ...p }) => <Tip text={label}><button type="button" aria-label={label} onClick={onClick} className={iconBtn} {...p}>{children}</button></Tip>;
const Lab = ({ children, text }) => <label className="inline-flex items-center gap-1.5">{text}{children}</label>;

// Two rows like the reference tool: look (palette, unit, colour range, actions), then data shaping (grid, band, sub pane, layers, zoom).
const ObhControls = ({ c }) => {
  const [lo, hi] = c.range;
  return (
    <div role="group" aria-label="Order book heatmap controls" className="mb-2 space-y-2 text-xs text-slate-400">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Lab text="Colouring">
          <i aria-hidden="true" className="inline-block h-2 w-10 rounded-sm" style={{ background: rampCss(c.palette) }} />
          <select aria-label="Colouring" value={c.palette} onChange={(e) => c.onPalette(e.target.value)} className={field}>
            {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Lab>
        <span className="inline-flex items-center gap-1.5">Unit
          <SegTabs label="Unit" active={c.unit} onChange={c.onUnit} tabs={UNITS} className="[&_button]:min-h-[44px] sm:[&_button]:min-h-0" />
        </span>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span id="obh-range-h">Colour range</span>
          <span role="group" aria-labelledby="obh-range-h" className="inline-flex items-center gap-1">
            <input type="range" min="0" max="99" value={lo} aria-label="Colour range minimum, percent of the brightest cell" onChange={(e) => c.onRange([Math.min(+e.target.value, hi - 1), hi])} className="h-11 w-20 accent-cyan-400 sm:h-auto" />
            <input type="range" min="1" max="100" value={hi} aria-label="Colour range maximum, percent of the brightest cell" onChange={(e) => c.onRange([lo, Math.max(+e.target.value, lo + 1)])} className="h-11 w-20 accent-cyan-400 sm:h-auto" />
          </span>
          <span data-testid="range-readout" className="tabular-nums">{fmtUnit((c.max * lo) / 100, c.unit)} - {fmtUnit((c.max * hi) / 100, c.unit)}</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Btn label="Download picture (PNG)" onClick={c.onShot}><Cam /></Btn>
          <Btn label="Refresh now" onClick={c.onRefresh} aria-busy={c.refreshing || undefined}><Icon name="refresh" /></Btn>
          <Btn label={c.isMax ? 'Restore chart' : 'Maximise chart'} aria-pressed={c.isMax} onClick={c.onToggleMax}><Icon name={c.isMax ? 'minimize' : 'maximize'} /></Btn>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Lab text="Price grid">
          <select aria-label="Price grid" value={c.grid} onChange={(e) => c.onGrid(+e.target.value)} className={field}>
            {GRIDS.map((m) => <option key={m} value={m}>{c.baseStep ? fmtMarketPrice(c.baseStep * m) : `${m}x`}</option>)}
          </select>
        </Lab>
        <Lab text="Depth band">
          <select aria-label="Depth band" value={c.band} onChange={(e) => c.onBand(+e.target.value)} className={field}>
            {BANDS.map((b) => <option key={b} value={b}>{`±${b}%`}</option>)}
          </select>
        </Lab>
        <Lab text="Sub panes">
          <select aria-label="Sub panes" value={c.sub} onChange={(e) => c.onSub(e.target.value)} className={field}>
            {SUBPANES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Lab>
        <ObhMenu label="Layers" width="w-48">
          {LAYERS.map((l) => (
            <label key={l.id} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded px-1 hover:bg-slate-800 sm:min-h-0 sm:py-1">
              <input type="checkbox" checked={!!c.layers[l.id]} onChange={(e) => c.onLayers({ ...c.layers, [l.id]: e.target.checked })} className="accent-cyan-400" />{l.label}
            </label>
          ))}
        </ObhMenu>
        <span className="ml-auto"><ZoomControls k={c.zoom.view.k} onZoom={c.zoom.zoomBy} onReset={c.zoom.reset} label="order book heatmap" /></span>
      </div>
    </div>
  );
};

export default ObhControls;
