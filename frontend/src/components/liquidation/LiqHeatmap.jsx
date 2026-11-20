import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useCanvas from './useCanvas';
import SegTabs from '../ui/SegTabs';
import { Notice, Panel, coin, fmtPct, fmtPrice, fmtUsd, is404 } from './shared';
import { cellAt, heatColor, heatCss, niceTicks, scaleT, timeTicks } from './heat';

export const RANGES = ['12h', '24h', '3d', '1w'].map((id) => ({ id, label: id }));
const PAD = { l: 8, r: 66, t: 10, b: 22 };
// canvas height by viewport width: 560 at >= 1280, 440 at >= 768, 340 below
const heightFor = () => (window.innerWidth >= 1280 ? 560 : window.innerWidth >= 768 ? 440 : 340);
const BG = '#0b1120';
const UP = '#10b981'; // app tokens: positive / negative
const DOWN = '#ef4444';
const INK = '#94a3b8';
const RAMP_CSS = `linear-gradient(to right, ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => heatCss(i / 8)).join(',')})`;
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

// ImageData bitmap, one pixel per cell (row 0 of the data is the bottom row of the image). Zero cells and cells
// below `bottom` stay transparent so the panel background shows through.
function buildBitmap(d, bottom, top) {
  const c = document.createElement('canvas');
  c.width = d.cols;
  c.height = d.rows;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(d.cols, d.rows);
  for (let col = 0; col < d.cols; col += 1) {
    for (let r = 0; r < d.rows; r += 1) {
      const v = d.cells[col * d.rows + r];
      if (!(v > 0) || v < bottom) continue;
      const [R, G, B] = heatColor(scaleT(v, bottom, top));
      const o = ((d.rows - 1 - r) * d.cols + col) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const LiqHeatmap = ({ symbol, range, onRange, data, loading, error, onRefresh, refreshing, highlight }) => {
  const [H, setH] = useState(heightFor);
  useEffect(() => {
    const f = () => setH(heightFor());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const [lo, setLo] = useState(0); // intensity clamp, both as percent of the largest cell (linear scale)
  const [hi, setHi] = useState(100);
  const [hover, setHover] = useState(null);
  const ok = !!data && data.cols > 0 && data.candles?.length > 0;
  const top = ok ? (data.max * hi) / 100 : 0;
  const bottom = ok ? (data.max * lo) / 100 : 0;
  const bitmap = useMemo(() => (ok && typeof document !== 'undefined' ? buildBitmap(data, bottom, top) : null), [ok, data, bottom, top]);

  const draw = useCallback((ctx, W, Ht) => {
    if (!ok) return;
    const pw = W - PAD.l - PAD.r;
    const ph = Ht - PAD.t - PAD.b;
    const pMax = data.priceMin + data.rows * data.priceStep;
    const Y = (p) => PAD.t + ph * (1 - (p - data.priceMin) / (pMax - data.priceMin));
    ctx.clearRect(0, 0, W, Ht);
    ctx.fillStyle = BG;
    ctx.fillRect(PAD.l, PAD.t, pw, ph);
    if (bitmap) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, PAD.l, PAD.t, pw, ph);
    }
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillStyle = INK;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    niceTicks(data.priceMin, pMax, 7).forEach((p) => {
      ctx.beginPath(); ctx.moveTo(PAD.l, Y(p) + 0.5); ctx.lineTo(PAD.l + pw, Y(p) + 0.5); ctx.stroke();
      ctx.fillText(fmtPrice(p), PAD.l + pw + 6, Y(p) + 3);
    });
    const t1 = data.t0 + data.cols * data.colMs;
    ctx.textAlign = 'center';
    let prev = null;
    timeTicks(data.t0, t1, pw).forEach(({ t, x }) => {
      const d = new Date(t).toDateString();
      const px = PAD.l + x * pw;
      ctx.beginPath(); ctx.moveTo(px + 0.5, PAD.t); ctx.lineTo(px + 0.5, PAD.t + ph); ctx.stroke();
      ctx.fillStyle = prev && prev !== d ? '#e2e8f0' : INK;
      ctx.fillText(prev && prev !== d ? day(t) : hhmm(t), px, Ht - 7);
      prev = d;
    });
    // candles over the heat: 1px dark halo under the up/down colour so they stay visible on bright bands
    const cw = pw / data.cols;
    const bw = Math.max(1, cw * 0.7);
    data.candles.forEach((k, i) => {
      const x = PAD.l + (i + 0.5) * cw;
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
    // current price: dashed line + tag on the right axis
    const yp = Y(data.price);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(PAD.l, yp + 0.5); ctx.lineTo(PAD.l + pw, yp + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(PAD.l + pw, yp - 8, PAD.r - 2, 16);
    ctx.fillStyle = '#0b1120';
    ctx.textAlign = 'left';
    ctx.fillText(fmtPrice(data.price), PAD.l + pw + 4, yp + 3);
  }, [ok, data, bitmap]);

  const { wrap, canvas } = useCanvas(draw, H);

  const onMove = (e) => {
    const b = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - b.left;
    const y = e.clientY - b.top;
    const cell = cellAt(data, x / b.width, y / b.height);
    setHover(cell && { cell, x, y, w: b.width });
  };

  const label = ok
    ? `${coin(symbol)} estimated liquidation heatmap, ${range}: ${fmtUsd(data.totals.longUsd)} of long liquidation levels below ${fmtPrice(data.price)} and ${fmtUsd(data.totals.shortUsd)} of short levels above. ${data.largest ? `Largest level ${fmtUsd(data.largest.usd)} ${data.largest.side}s at ${fmtPrice(data.largest.price)}.` : 'No open levels.'}`
    : '';
  const hv = hover?.cell;
  const pMax = ok ? data.priceMin + data.rows * data.priceStep : 0;
  const pctY = (p) => `${(1 - (p - data.priceMin) / (pMax - data.priceMin)) * 100}%`;

  return (
    <Panel
      title={`Predicted liquidation heatmap - ${coin(symbol)}`}
      right={(
        <div className="flex flex-wrap items-center gap-2">
          <SegTabs label="Heatmap range" tabs={RANGES} active={range} onChange={(r) => { setHover(null); onRange(r); }} />
          {ok && <span className="text-[11px] tabular-nums text-slate-500">Updated {hhmm(data.generatedAt)} · refreshes every 60s</span>}
          <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh heatmap" className="focus-ring inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:text-slate-100">
            {refreshing && <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />}
            Refresh
          </button>
        </div>
      )}
    >
      <p className="mb-2 text-xs text-amber-400">
        Estimated model. Exchanges do not publish liquidation prices; levels are inferred from open-interest increases, a leverage mix of 5x–125x and 0.4% maintenance margin. Not financial advice.
      </p>
      {!ok ? (
        <Notice tone={error ? 'error' : 'muted'}>
          {loading ? 'Loading heatmap...' : is404(error) ? `No perpetual futures market for ${symbol}.` : error ? 'Heatmap unavailable right now, retrying.' : 'Not enough data to estimate a heatmap.'}
        </Notice>
      ) : (
        <>
          <div ref={wrap} className="relative" style={{ height: H }}>
            <canvas ref={canvas} role="img" aria-label={label} className="block" />
            <div
              aria-hidden="true"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
              className="absolute cursor-crosshair"
              style={{ left: PAD.l, top: PAD.t, right: PAD.r, bottom: PAD.b }}
            >
              {highlight != null && (
                <div className="pointer-events-none absolute inset-x-0 border-y border-white bg-white/20" style={{ top: pctY(highlight + data.priceStep / 2), height: `${100 / data.rows}%`, minHeight: 5 }} />
              )}
              {hover && (
                <>
                  <div className="pointer-events-none absolute inset-y-0 w-px bg-slate-200/50" style={{ left: hover.x }} />
                  <div className="pointer-events-none absolute inset-x-0 h-px bg-slate-200/50" style={{ top: hover.y }} />
                  <div className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200 shadow" style={{ left: Math.min(hover.x + 12, hover.w - 200), top: Math.max(0, hover.y - 72) }}>
                    <div>{day(hv.time)} {hhmm(hv.time)}</div>
                    <div className="text-slate-400">{fmtPrice(hv.priceLo)} - {fmtPrice(hv.priceHi)}</div>
                    <div>Est. open liquidations {hv.usd > 0 ? fmtUsd(hv.usd) : 'none'}</div>
                    <div className="text-slate-400">{fmtPct(((hv.priceLo + hv.priceHi) / 2 / data.price - 1) * 100)} from price</div>
                  </div>
                </>
              )}
            </div>
            {data.max === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-1/4 px-4 text-center text-sm text-slate-300">No open liquidation levels estimated in this window.</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-2">
              <span>Intensity (linear)</span>
              <span className="tabular-nums">{fmtUsd(bottom)}</span>
              <i className="inline-block h-2 w-28 rounded-sm" style={{ background: RAMP_CSS }} aria-hidden="true" />
              <span className="tabular-nums">{fmtUsd(top)}</span>
            </span>
            <label className="inline-flex items-center gap-1">Min
              <input type="range" min="0" max="99" value={lo} aria-label="Intensity minimum, percent of largest cell" onChange={(e) => setLo(Math.min(+e.target.value, hi - 1))} className="w-20 accent-cyan-400" />
              <span className="w-20 tabular-nums">{lo}% · {fmtUsd(bottom)}</span>
            </label>
            <label className="inline-flex items-center gap-1">Max
              <input type="range" min="1" max="100" value={hi} aria-label="Intensity maximum, percent of largest cell" onChange={(e) => setHi(Math.max(+e.target.value, lo + 1))} className="w-20 accent-cyan-400" />
              <span className="w-20 tabular-nums">{hi}% · {fmtUsd(top)}</span>
            </label>
            <span><i className="mr-1 inline-block h-2 w-2" style={{ background: UP }} />up candle <i className="ml-2 mr-1 inline-block h-2 w-2" style={{ background: DOWN }} />down candle</span>
          </div>
        </>
      )}
    </Panel>
  );
};

export default LiqHeatmap;
