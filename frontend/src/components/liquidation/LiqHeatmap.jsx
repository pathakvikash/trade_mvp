import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import useCanvas from './useCanvas';
import SegTabs from '../ui/SegTabs';
import { PARTIAL_NOTE, sourceNote, Notice, Panel, StaleNote, coin, fmtMarketPrice, fmtPct, fmtPrice, fmtUsd, is404 } from './shared';
import { buildCursor, cellAt, cellOf, cellTP, closeRow, heatColor, lensKeeps, niceTicks, rampCss, scaleT, sweptBetween, timeTicks } from './heat';
import HeatControls from './HeatControls';
import HeatHoverCard from './HeatHoverCard';
import LayoutMenu from './LayoutMenu';
import useHeatView from './heatView';
import useZoomPan from './useZoomPan';
import ZoomControls from './ZoomControls';
import { reveal, toFull, toView } from './zoomView';
import { LoadingBlock } from '../ui/Skeleton';
import { Updating } from '../ui/Spinner';

export const RANGES = ['12h', '24h', '3d', '1w'].map((id) => ({ id, label: id }));
const PAD = { l: 8, r: 66, t: 10, b: 22 };
// canvas height by viewport width: 560 at >= 1280, 440 at >= 768, 340 below
const heightFor = () => (window.innerWidth >= 1280 ? 560 : window.innerWidth >= 768 ? 440 : 340);
const BG = '#0b1120';
const UP = '#10b981'; // app tokens: positive / negative
const DOWN = '#ef4444';
const INK = '#94a3b8';
const MODES = [
  { id: 'pan', label: 'Pan', title: 'Pan: hover or tap to inspect cells' },
  { id: 'measure', label: 'Measure', title: 'Measure: click two points to compare price and time' },
];
const dur = (ms) => {
  const m = Math.round(ms / 60000);
  if (m <= 0) return null;
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

// ImageData bitmap, one pixel per cell (row 0 of the data is the bottom row of the image). Zero cells and cells
// below `bottom` (or on the other side of the price when a long/short lens is on) stay transparent so the panel background shows through.
function buildBitmap(d, bottom, top, palette, lens) {
  const c = document.createElement('canvas');
  c.width = d.cols;
  c.height = d.rows;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(d.cols, d.rows);
  for (let col = 0; col < d.cols; col += 1) {
    for (let r = 0; r < d.rows; r += 1) {
      const v = d.cells[col * d.rows + r];
      if (!(v > 0) || v < bottom || !lensKeeps(d, lens, r, col)) continue;
      const [R, G, B] = heatColor(scaleT(v, bottom, top), palette);
      const o = ((d.rows - 1 - r) * d.cols + col) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// embedded: rendered inside another panel (the Trade/Market chart): no Panel shell, a compact toolbar and estimate caption,
// the canvas fills the space it is given (min 280px below xl) and the layout/measure/screenshot extras are left out.
const EMB_MIN = 120; // floor for the measured height; below xl the CSS min-height (280) is what sets the size
const LiqHeatmap = ({ symbol, range, onRange, data, source, loading, error, onRefresh, refreshing, highlight, embedded = false }) => {
  const [H0, setH] = useState(heightFor);
  const area = useRef(null);
  const [eh, setEh] = useState(EMB_MIN);
  useEffect(() => {
    const f = () => setH(heightFor());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const H = embedded ? eh : H0;
  const { lens, setLens, palette, setPalette, display, setDisplay, intensity, setIntensity } = useHeatView();
  const [lo, hi] = intensity; // intensity clamp, both as percent of the largest cell (linear scale)
  const [hover, setHover] = useState(null); // {col, row, x, y (plot px), cx, cy (viewport px), touch, t, price}; t/price survive a refresh
  const [mode, setMode] = useState('pan');
  const [points, setPoints] = useState([]); // measure mode: up to two {t, price} (time ms, bucket middle): grid indices move when the window refreshes
  const [shotErr, setShotErr] = useState(false);
  const touchRef = useRef(false); // the latest pointer was a touch: only then does a click pin the card
  const plotRef = useRef(null);
  const cardId = useId();
  useEffect(() => { setHover(null); setPoints([]); }, [symbol]); // positions belong to one symbol's grid
  // The card is position:fixed at viewport coordinates: scrolling any ancestor or resizing would leave it stranded.
  useEffect(() => {
    if (!hover) return undefined;
    const close = () => setHover(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [!!hover]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = !!data && data.cols > 0 && data.candles?.length > 0;
  // Zoom both axes (time and price) together, anchored at the pointer; a pure client transform of the data already loaded.
  // The intensity legend and colour scale stay global (relative to the largest cell of the whole window), so colours mean the same zoomed or not.
  const zoom = useZoomPan(plotRef, { axes: 'xy', resetKey: `${symbol}|${range}`, enabled: ok });
  const { view } = zoom;
  // A refresh moves the window (t0, priceMin) and zooming/panning moves the view: keep a hover/pinned card on the same time
  // and price, re-place it on screen, and drop it when that left the data or the visible window.
  useEffect(() => {
    setHover((h) => {
      if (!h || !data || !data.cols) return h;
      const c = cellOf(data, h.t, h.price);
      const b = plotRef.current?.getBoundingClientRect();
      if (!c || !b) return null;
      const x = toView(view, view.ox, (c.col + 0.5) / data.cols) * b.width;
      const y = toView(view, view.oy, 1 - (c.row + 0.5) / data.rows) * b.height;
      if (x < 0 || x > b.width || y < 0 || y > b.height) return null;
      if (c.col === h.col && c.row === h.row && Math.abs(x - h.x) < 0.5 && Math.abs(y - h.y) < 0.5) return h;
      return { ...h, ...c, x, y, cx: b.left + x, cy: b.top + y };
    });
  }, [data?.t0, data?.priceMin, data?.priceStep, data?.colMs, data?.cols, data?.rows, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!embedded || !ok || !area.current || typeof ResizeObserver === 'undefined') return undefined;
    const el = area.current;
    const f = () => setEh(Math.max(EMB_MIN, Math.round(el.clientHeight)));
    f();
    const ro = new ResizeObserver(f);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embedded, ok]);
  const top = ok ? (data.max * hi) / 100 : 0;
  const bottom = ok ? (data.max * lo) / 100 : 0;
  const bitmap = useMemo(() => (ok && typeof document !== 'undefined' ? buildBitmap(data, bottom, top, palette, lens) : null), [ok, data, bottom, top, palette, lens]);

  const draw = useCallback((ctx, W, Ht) => {
    if (!ok) return;
    const pw = W - PAD.l - PAD.r;
    const ph = Ht - PAD.t - PAD.b;
    const pMax = data.priceMin + data.rows * data.priceStep;
    const pSpan = pMax - data.priceMin;
    const t1 = data.t0 + data.cols * data.colMs;
    const v = view;
    const Y = (p) => PAD.t + ph * toView(v, v.oy, 1 - (p - data.priceMin) / pSpan);
    const pHi = pMax - toFull(v, v.oy, 0) * pSpan; // visible price window
    const pLo = pMax - toFull(v, v.oy, 1) * pSpan;
    const tv0 = data.t0 + toFull(v, v.ox, 0) * (t1 - data.t0); // visible time window
    const tv1 = data.t0 + toFull(v, v.ox, 1) * (t1 - data.t0);
    ctx.clearRect(0, 0, W, Ht);
    ctx.fillStyle = BG;
    ctx.fillRect(PAD.l, PAD.t, pw, ph);
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, pw, ph);
    ctx.clip(); // everything zoomed stays inside the plot
    if (bitmap) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, v.ox * data.cols, v.oy * data.rows, data.cols / v.k, data.rows / v.k, PAD.l, PAD.t, pw, ph);
    }
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillStyle = INK;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    niceTicks(pLo, pHi, 7).forEach((p) => {
      if (display.grid) { ctx.beginPath(); ctx.moveTo(PAD.l, Y(p) + 0.5); ctx.lineTo(PAD.l + pw, Y(p) + 0.5); ctx.stroke(); }
      ctx.fillText(fmtMarketPrice(p), PAD.l + pw + 6, Y(p) + 3);
    });
    ctx.textAlign = 'center';
    let prev = null;
    timeTicks(tv0, tv1, pw).forEach(({ t, x }) => {
      const d = new Date(t).toDateString();
      const px = PAD.l + x * pw;
      if (display.grid) { ctx.beginPath(); ctx.moveTo(px + 0.5, PAD.t); ctx.lineTo(px + 0.5, PAD.t + ph); ctx.stroke(); }
      ctx.fillStyle = prev && prev !== d ? '#e2e8f0' : INK;
      ctx.fillText(prev && prev !== d ? day(t) : hhmm(t), px, Ht - 7);
      prev = d;
    });
    // key liquidation levels (display toggle): dashed line per level, rose above the price, emerald below
    if (display.keyLevels && data.keyLevels) {
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      [[data.keyLevels.above, '#fb7185'], [data.keyLevels.below, '#34d399']].forEach(([list, color]) => (list || []).forEach((l) => {
        const y = Y(l.price);
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(PAD.l, y + 0.5); ctx.lineTo(PAD.l + pw, y + 0.5); ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillText(fmtUsd(l.usd), PAD.l + 4, y - 3);
      }));
      ctx.restore();
    }
    // candles over the heat: 1px dark halo under the up/down colour so they stay visible on bright bands
    const cw = (pw / data.cols) * v.k;
    const bw = Math.max(1, cw * 0.7);
    if (display.candles) data.candles.forEach((k, i) => {
      const x = PAD.l + pw * toView(v, v.ox, (i + 0.5) / data.cols);
      if (x < PAD.l - cw || x > PAD.l + pw + cw) return;
      const yO = Y(k.open);
      const yC = Y(k.close);
      const by = Math.min(yO, yC);
      const bh = Math.max(1, Math.abs(yO - yC));
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, Y(k.high)); ctx.lineTo(x, Y(k.low)); ctx.stroke();
      ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
      ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, bh + 2);
      ctx.strokeStyle = k.close >= k.open ? UP : DOWN;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(k.high)); ctx.lineTo(x, Y(k.low)); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(x - bw / 2, by, bw, bh);
    });
    ctx.restore();
    // current price: dashed line (while in view) + tag on the right axis, pinned to the plot edge when the price is zoomed out of view
    if (!display.priceLine) return;
    const yp = Y(data.price);
    const ypc = Math.min(PAD.t + ph - 8, Math.max(PAD.t + 8, yp));
    if (yp >= PAD.t && yp <= PAD.t + ph) {
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.moveTo(PAD.l, yp + 0.5); ctx.lineTo(PAD.l + pw, yp + 0.5); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(PAD.l + pw, ypc - 8, PAD.r - 2, 16);
    ctx.fillStyle = '#0b1120';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(data.price), PAD.l + pw + 4, ypc + 3);
  }, [ok, data, bitmap, display, view]);

  const { wrap, canvas } = useCanvas(draw, H);

  // Plot-area cell under a viewport point, or null.
  const cellFrom = (e) => {
    const b = e.currentTarget.getBoundingClientRect();
    const cell = cellAt(data, toFull(view, view.ox, (e.clientX - b.left) / b.width), toFull(view, view.oy, (e.clientY - b.top) / b.height));
    return cell && { col: cell.col, row: cell.row, ...cellTP(data, cell.col, cell.row), x: e.clientX - b.left, y: e.clientY - b.top, cx: e.clientX, cy: e.clientY };
  };
  const addPoint = (c) => setPoints((p) => { const pt = { t: c.t, price: c.price }; return p.length === 1 ? [p[0], pt] : [pt]; });
  // Pointer events: hover follows mouse and pen only; a touch never moves the cursor (its emulated mouse events are not used).
  // The pointer type is tracked on every event, so a mouse used after a touch hovers again.
  const onMove = (e) => {
    touchRef.current = e.pointerType === 'touch';
    const panning = zoom.handlers.move(e);
    if (touchRef.current) return;
    if (panning || zoom.isDragging()) { setHover(null); return; }
    const c = cellFrom(e);
    setHover(c && { ...c, touch: false });
  };
  const onClick = (e) => {
    if (zoom.wasDragged()) return; // the click that ends a pan or pinch is not a tap
    const c = cellFrom(e);
    if (!c) return;
    if (mode === 'measure') addPoint(c);
    else if (touchRef.current) setHover({ ...c, touch: true }); // a tap shows the card until it is closed
  };
  // Keyboard: arrows move the cursor cell, Enter/Space places a measure point, Escape closes the card.
  const onKey = (e) => {
    if (zoom.key(e)) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (e.key === 'Escape') { if (hover) e.stopPropagation(); setHover(null); return; } // a close here must not also un-maximise the panel around it
    const cur = hover || { col: data.cols - 1, row: closeRow(data) };
    let { col, row } = cur;
    if (step) { col = Math.min(data.cols - 1, Math.max(0, col + step[0])); row = Math.min(data.rows - 1, Math.max(0, row + step[1])); } else if (!(e.key === 'Enter' || e.key === ' ')) return;
    e.preventDefault();
    const b = e.currentTarget.getBoundingClientRect();
    const nv = reveal(view, (col + 0.5) / data.cols, 1 - (row + 0.5) / data.rows); // pan if the cursor cell left the visible window
    if (nv.ox !== view.ox || nv.oy !== view.oy) zoom.setView(nv);
    const x = toView(nv, nv.ox, (col + 0.5) / data.cols) * b.width;
    const y = toView(nv, nv.oy, 1 - (row + 0.5) / data.rows) * b.height;
    const c = { col, row, ...cellTP(data, col, row), x, y, cx: b.left + x, cy: b.top + y, touch: false };
    setHover(c);
    if (!step && mode === 'measure') addPoint(c);
  };
  const setMode2 = (m) => { setMode(m); setPoints([]); };

  const screenshot = () => {
    try {
      const src = canvas.current;
      if (!src) throw new Error('no canvas');
      const out = document.createElement('canvas'); // flatten onto the panel colour: the plot margins are transparent
      out.width = src.width;
      out.height = src.height;
      const c = out.getContext('2d');
      c.fillStyle = BG;
      c.fillRect(0, 0, out.width, out.height);
      c.drawImage(src, 0, 0);
      out.toBlob((blob) => {
        if (!blob) { setShotErr(true); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${coin(symbol)}-liquidation-heatmap-${range}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setShotErr(false);
      }, 'image/png');
    } catch {
      setShotErr(true);
    }
  };

  const label = ok
    ? `${coin(symbol)} estimated liquidation heatmap, ${range}: ${fmtUsd(data.totals.longUsd)} of long liquidation levels below ${fmtPrice(data.price)} and ${fmtUsd(data.totals.shortUsd)} of short levels above. ${data.largest ? `Largest level ${fmtUsd(data.largest.usd)} ${data.largest.side}s at ${fmtPrice(data.largest.price)}.` : 'No open levels.'}`
    : '';
  const pMax = ok ? data.priceMin + data.rows * data.priceStep : 0;
  const pctY = (p) => `${toView(view, view.oy, 1 - (p - data.priceMin) / (pMax - data.priceMin)) * 100}%`;
  const cursor = ok && hover ? buildCursor(data, hover.col, hover.row) : null;
  // Points are kept as time + price; the grid cell is worked out against the current window, and a point whose time or
  // price is no longer inside it is hidden (cell = null).
  const withCell = (pt) => pt && { ...pt, cell: cellOf(data, pt.t, pt.price) };
  const pos = (pt) => ({ x: toView(view, view.ox, (pt.cell.col + 0.5) / data.cols) * 100, y: toView(view, view.oy, 1 - (pt.cell.row + 0.5) / data.rows) * 100 });
  const visible = (pt) => { const p = pt && pt.cell && pos(pt); return !!p && p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100; };
  const [pa, pb] = ok ? points.map(withCell) : [];
  const shown = ok ? [pa, pb].filter(visible) : [];
  const readout = !ok || mode !== 'measure' ? null : !pa ? 'Measure: click two points on the heatmap.' : !pb ? `Point 1: ${hhmm(pa.t)} at ${fmtPrice(pa.price)}. Click a second point.` : (
    `Measured: ${fmtPct((pb.price / pa.price - 1) * 100)} in price (${fmtPrice(pa.price)} to ${fmtPrice(pb.price)}), ${dur(Math.abs(pb.t - pa.t)) || 'no time'} apart. ${pb.cell && pa.cell ? `Estimated open liquidation levels between those prices at the second time: ${fmtUsd(sweptBetween(data, pb.cell.col, pa.cell.row, pb.cell.row))} (model estimate).` : 'A point has left the visible window, so the open-level estimate is not available.'}`
  );

  const right = (
    embedded ? (
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <SegTabs label="Heatmap range" tabs={RANGES} active={range} onChange={(r) => { setHover(null); setPoints([]); onRange(r); }} className="[&_button]:min-h-[44px] sm:[&_button]:min-h-0" />
        {ok && <ZoomControls k={view.k} onZoom={zoom.zoomBy} onReset={zoom.reset} label="heatmap" />}
        {ok && <span className="text-[11px] tabular-nums text-slate-500">Updated {hhmm(data.generatedAt)}</span>}
        <Updating show={!!refreshing} />
        <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh heatmap" className="focus-ring inline-flex min-h-[44px] items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:text-slate-100 sm:min-h-0">Refresh</button>
      </div>
    ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SegTabs label="Heatmap range" tabs={RANGES} active={range} onChange={(r) => { setHover(null); setPoints([]); onRange(r); }} />
          <LayoutMenu value="single" onChange={() => {}} />
          <SegTabs label="Pointer mode" tabs={MODES} active={mode} onChange={setMode2} />
          {ok && <ZoomControls k={view.k} onZoom={zoom.zoomBy} onReset={zoom.reset} label="heatmap" />}
          {ok && <span className="text-[11px] tabular-nums text-slate-500">Updated {hhmm(data.generatedAt)} · refreshes every 60s</span>}
          <Updating show={!!refreshing} />
          <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh heatmap" className="focus-ring inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:text-slate-100">
            {refreshing && <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />}
            Refresh
          </button>
          {ok && <button type="button" onClick={screenshot} aria-label="Download heatmap screenshot" className="focus-ring rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:text-slate-100">Screenshot</button>}
        </div>
    )
  );
  const inner = (
    <>
      {embedded ? (
        <p data-testid="heat-estimate" className="mb-1 text-[11px] text-amber-400">
          Estimate: levels are inferred from open-interest changes, not exchange data; the liquidation feed is sampled. Not financial advice.
        </p>
      ) : (
        <p className="mb-2 text-xs text-amber-400">
          Estimated model. Exchanges do not publish liquidation prices; levels are inferred from open-interest increases, a leverage mix of 5x–125x and 0.4% maintenance margin. Not financial advice.
        </p>
      )}
      {sourceNote(source, 'heatmap') && <p className="mb-2 text-xs text-amber-400">{sourceNote(source, 'heatmap')}</p>}
      {ok && error && <StaleNote at={data.generatedAt} />}
      {data?.partial && <p className="mb-2 text-xs text-amber-400">{PARTIAL_NOTE}</p>}
      {shotErr && <p role="status" className="mb-2 text-xs text-amber-400">Screenshot failed in this browser. Try again, or use the system screenshot tool.</p>}
      {ok && <HeatControls lens={lens} onLens={setLens} palette={palette} onPalette={setPalette} intensity={intensity} onIntensity={setIntensity} max={data.max} display={display} onDisplay={setDisplay} className={embedded ? '[&_select]:min-h-[44px] [&_button]:min-h-[44px] sm:[&_select]:min-h-0 sm:[&_button]:min-h-0' : ''} />}
      {!ok ? (
        loading ? <LoadingBlock height={H} /> : (
          <Notice tone={error ? 'error' : 'muted'}>
            {is404(error) ? `No perpetual futures market for ${symbol}.` : error ? 'Heatmap unavailable right now, retrying.' : 'Not enough data to estimate a heatmap.'}
          </Notice>
        )
      ) : (
        <>
          <div ref={embedded ? area : undefined} className={embedded ? 'relative min-h-[280px] flex-1 xl:min-h-0' : undefined}>
          <div ref={wrap} className={`${embedded ? 'absolute inset-x-0 top-0' : 'relative'} transition-opacity ${refreshing ? 'opacity-60' : ''}`} style={{ height: H }}>
            <canvas ref={canvas} role="img" aria-label={label} className="block" />
            <div
              role="group"
              tabIndex={0}
              aria-label="Heatmap cell cursor. Arrow keys move between cells, Enter places a measure point, Escape closes the details. Plus and minus keys zoom, 0 resets; Ctrl or Cmd plus wheel or pinch also zoom, drag pans."
              aria-describedby={cursor ? cardId : undefined}
              ref={plotRef}
              onPointerDown={(e) => { touchRef.current = e.pointerType === 'touch'; zoom.handlers.down(e); }}
              onPointerMove={onMove}
              onPointerUp={zoom.handlers.up}
              onPointerCancel={zoom.handlers.up}
              onDoubleClick={() => { if (view.k > 1) { zoom.reset(); setPoints([]); } }}
              onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover((h) => (h?.touch ? h : null)); }}
              onClick={onClick}
              onKeyDown={onKey}
              onBlur={() => setHover((h) => (h?.touch ? h : null))}
              className="absolute cursor-crosshair focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              style={{ left: PAD.l, top: PAD.t, right: PAD.r, bottom: PAD.b, touchAction: 'pan-y' }}
            >
              {highlight != null && (
                <div className="pointer-events-none absolute inset-x-0 border-y border-white bg-white/20" style={{ top: pctY(highlight + data.priceStep / 2), height: `${(100 / data.rows) * view.k}%`, minHeight: 5 }} />
              )}
              {mode === 'measure' && shown.length > 0 && (
                <>
                  {shown.length === 2 && (
                    <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
                      <line x1={pos(pa).x} y1={pos(pa).y} x2={pos(pb).x} y2={pos(pb).y} stroke="#f8fafc" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
                    </svg>
                  )}
                  {shown.map((pt, i) => <span key={i} data-testid="measure-point" className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-400" style={{ left: `${pos(pt).x}%`, top: `${pos(pt).y}%` }} />)}
                </>
              )}
              {hover && (
                <>
                  <div className="pointer-events-none absolute inset-y-0 w-px bg-slate-200/50" style={{ left: hover.x }} />
                  <div className="pointer-events-none absolute inset-x-0 h-px bg-slate-200/50" style={{ top: hover.y }} />
                  <HeatHoverCard cursor={cursor} id={cardId} anchor={{ x: hover.cx, y: hover.cy }} palette={palette} bottom={bottom} top={top} touch={hover.touch} onClose={() => setHover(null)} />
                </>
              )}
            </div>
            {data.max === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-1/4 px-4 text-center text-sm text-slate-300">No open liquidation levels estimated in this window.</p>
            )}
          </div>
          </div>
          {readout && (
            <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <span>{readout}</span>
              {pa && <button type="button" onClick={() => setPoints([])} className="focus-ring rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:text-slate-100">Clear</button>}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span>Intensity (linear)</span>
              <span className="tabular-nums">{fmtUsd(bottom)}</span>
              <i className="inline-block h-2 w-28 rounded-sm" style={{ background: rampCss(palette) }} aria-hidden="true" />
              <span className="tabular-nums">{fmtUsd(top)}</span>
            </span>
            <span><i className="mr-1 inline-block h-2 w-2" style={{ background: UP }} />up candle <i className="ml-2 mr-1 inline-block h-2 w-2" style={{ background: DOWN }} />down candle</span>
          </div>
        </>
      )}
    </>
  );
  if (embedded) return <div id="liq-heatmap-embedded" className="flex min-h-0 flex-1 flex-col xl:overflow-hidden">{right}{inner}</div>;
  return (
    <Panel
      id="liq-heatmap"
      title={`Predicted liquidation heatmap - ${coin(symbol)}`}
      right={right}
    >
      {inner}
    </Panel>
  );
};

export default LiqHeatmap;
