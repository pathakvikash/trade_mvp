import React, { forwardRef, useCallback, useImperativeHandle, useState } from 'react';
import useCanvas from './useCanvas';
import { PAD, SUB_H, fmtDur, fmtUnit } from './obh';
import { drawObh, pointAt } from './obhDraw';
import { coin, fmtMarketPrice, fmtTime } from './shared';
import { collectingText } from './orderflow';

const NEAR = 0.004; // a wall counts for the hovered cell when it is within 0.4% of the cell's price

// The chart: heat, candles, price line, wall tags, trade bubbles (all on the canvas) plus an HTML plot layer for the crosshair,
// the readout and the hover card. The plot layer is also the zoom/pan target (zoom state lives in the container).
const ObhCanvas = forwardRef(({ symbol, d, cells, max, palette, range, layers, candles, ivMs, sub, unit, interval, zoom, plotRef, height }, ref) => {
  const [hover, setHover] = useState(null);
  const { view } = zoom;
  const draw = useCallback((ctx, W, Ht) => drawObh(ctx, W, Ht, { d, cells, max, palette, range, view, layers, candles, ivMs, sub }), [d, cells, max, palette, range, view, layers, candles, ivMs, sub]);
  const { wrap, canvas } = useCanvas(draw, height);
  useImperativeHandle(ref, () => ({ toBlob: (cb) => canvas.current?.toBlob?.(cb) }), [canvas]);
  const subH = sub === 'volume' ? SUB_H : 0;

  const onMove = (e) => {
    const panning = zoom.handlers.move(e);
    if (e.pointerType === 'touch') return;
    if (panning || zoom.isDragging()) { setHover(null); return; }
    const f = zoom.frac(e.clientX, e.clientY);
    if (f.fx < 0 || f.fx > 1 || f.fy < 0 || f.fy > 1) { setHover(null); return; }
    setHover({ ...pointAt(d, view, f.fx, f.fy), x: f.fx * f.w, y: f.fy * f.h, w: f.w });
  };
  const wallNear = hover && d.walls.active.find((w) => Math.abs(w.price - hover.price) / hover.price < NEAR);
  const label = `${coin(symbol)} order book heatmap: resting order size by price over the last ${Math.round((d.collectedMs || 0) / 60e3)} minutes, collected from depth snapshots. Brightest cell ${fmtUnit(max, unit)}.`;
  const readout = hover || { t: d.t0 + d.cols * d.colMs, inside: true };

  return (
    <div ref={wrap} className="relative" style={{ height }}>
      <canvas role="img" ref={canvas} aria-label={label} className="block" />
      <div
        role="group"
        tabIndex={0}
        aria-label="Order book heatmap cursor. Plus and minus keys zoom, 0 resets; Ctrl or Cmd plus wheel or pinch also zoom, drag pans. The book, walls and events are listed in the panel beside the chart."
        ref={plotRef}
        onPointerDown={zoom.handlers.down}
        onPointerMove={onMove}
        onPointerUp={zoom.handlers.up}
        onPointerCancel={zoom.handlers.up}
        onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null); }}
        onDoubleClick={() => { if (view.k > 1) zoom.reset(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setHover(null); else zoom.key(e); }}
        className="absolute cursor-crosshair focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        style={{ left: PAD.l, top: PAD.t, right: PAD.r, bottom: PAD.b + subH, touchAction: 'pan-y' }}
      >
        {hover?.inside && (
          <>
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white/40" style={{ left: hover.x }} />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-px bg-white/40" style={{ top: hover.y }} />
          </>
        )}
      </div>
      <p data-testid="crosshair-readout" className="pointer-events-none absolute left-2 top-1 max-w-[calc(100%-5rem)] truncate rounded bg-slate-950/70 px-1.5 text-[11px] tabular-nums text-slate-300">
        {coin(symbol)} {'·'} {d.source === 'bybit' ? 'Bybit' : 'Binance'} Perp {'·'} {interval} {'  '}{fmtTime(readout.t)} {'  '}Bid {fmtMarketPrice(d.book.bestBid)} Ask {fmtMarketPrice(d.book.bestAsk)} {'  '}Grid {fmtMarketPrice(d.priceStep)}
      </p>
      <span role="status" className="pointer-events-none absolute right-[78px] top-1 inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-950/80 px-2 text-[11px] text-slate-300">
        <i aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />{collectingText(d.collectedMs).replace('Collecting data, ', 'Collecting ').replace(' so far', '')}
      </span>
      {hover?.inside && (
        <div className="pointer-events-none absolute z-10 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200" style={{ top: PAD.t + 26, left: Math.max(4, Math.min(PAD.l + hover.x + 12, PAD.l + hover.w - 170)) }}>
          <div>{fmtTime(hover.t)}</div>
          <div>{fmtMarketPrice(hover.price)}</div>
          <div>Resting size {hover.usd > 0 ? fmtUnit(unit === 'qty' ? hover.usd / hover.price : hover.usd, unit) : 'none seen'}</div>
          <div>Age {fmtDur(d.t0 + (d.cols - 1) * d.colMs - hover.t)} before latest{wallNear ? `, wall up ${fmtDur(wallNear.upForMs)}` : ''}</div>
        </div>
      )}
    </div>
  );
});

export default ObhCanvas;
