import React, { useCallback, useState } from 'react';
import usePersistedState from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import useCanvas from './useCanvas';
import { LoadingBlock } from '../ui/Skeleton';
import { PALETTES, cellAt, heatColor, niceTicks, rampCss, timeTicks } from './heat';
import { ORDERFLOW, THIN_TEXT, collectingText, flowNotice } from './orderflow';
import { Notice, Panel, StaleNote, coin, fmtMarketPrice, fmtTime, fmtUsd } from './shared';

const H = 320;
const PAD = { l: 8, r: 64, t: 8, b: 22 };

// Resting order size (USD) by price over time, from depth snapshots the server has collected since it started for this coin.
export const drawBook = (ctx, W, Ht, d, palette) => {
  const pw = W - PAD.l - PAD.r;
  const ph = Ht - PAD.t - PAD.b;
  const cw = pw / d.cols;
  const rh = ph / d.rows;
  const Y = (p) => PAD.t + ph - ((p - d.priceMin) / (d.priceStep * d.rows)) * ph;
  ctx.clearRect(0, 0, W, Ht);
  const gap = new Set(d.gaps);
  for (let c = 0; c < d.cols; c += 1) {
    if (gap.has(c)) continue;
    for (let r = 0; r < d.rows; r += 1) {
      const v = d.cells[c * d.rows + r];
      if (!(v > 0)) continue;
      const [R, G, B] = heatColor(d.max > 0 ? v / d.max : 0, palette);
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(PAD.l + c * cw, PAD.t + ph - (r + 1) * rh, Math.ceil(cw), Math.ceil(rh));
    }
  }
  // price path (the mid of each column) and the current price
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  d.mids.forEach((m, c) => {
    if (m == null) { pen = false; return; }
    const x = PAD.l + (c + 0.5) * cw;
    if (pen) ctx.lineTo(x, Y(m)); else ctx.moveTo(x, Y(m));
    pen = true;
  });
  ctx.stroke();
  ctx.font = '10px ui-sans-serif, system-ui';
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  niceTicks(d.priceMin, d.priceMin + d.priceStep * d.rows, 5).forEach((p) => ctx.fillText(fmtMarketPrice(p), PAD.l + pw + 4, Y(p) + 3));
  ctx.textAlign = 'center';
  timeTicks(d.t0, d.t0 + d.cols * d.colMs, pw, 70).forEach((k) => ctx.fillText(fmtTime(k.t).replace(/:\d\d(?!\d)/, ''), PAD.l + k.x * pw, Ht - 6));
  ctx.fillStyle = '#22d3ee';
  ctx.textAlign = 'left';
  ctx.fillText(fmtMarketPrice(d.price), PAD.l + pw + 4, Math.max(PAD.t + 8, Math.min(PAD.t + ph, Y(d.price) - 6)));
};

const OrderBookHeatmap = ({ symbol }) => {
  const [palette, setPalette] = usePersistedState('orderflow.palette', 'viridis', { validate: (v) => PALETTES.some((p) => p.id === v) });
  const { data, error, loading } = usePolling(`${ORDERFLOW}/heatmap/${symbol}`, 5000, undefined, undefined, true);
  const [hover, setHover] = useState(null);
  const ok = !!data && data.symbol === symbol && data.cols > 0;
  const draw = useCallback((ctx, W, Ht) => { if (ok) drawBook(ctx, W, Ht, data, palette); }, [ok, data, palette]);
  const { wrap, canvas } = useCanvas(draw, H);
  const notice = flowNotice(error, data);
  const collecting = data && !ok;

  const onMove = (e) => {
    if (!ok) return;
    const b = canvas.current.getBoundingClientRect();
    const fx = (e.clientX - b.left - PAD.l) / (b.width - PAD.l - PAD.r);
    const fy = (e.clientY - b.top - PAD.t) / (H - PAD.t - PAD.b);
    const cell = cellAt(data, fx, fy);
    setHover(cell && { cell, x: e.clientX - b.left, w: b.width });
  };
  const label = ok ? `${coin(symbol)} order book heatmap: resting order size by price over the last ${Math.round((data.collectedMs || 0) / 60e3)} minutes, collected from depth snapshots. Maximum cell ${fmtUsd(data.max)}.` : '';

  return (
    <Panel id="order-book-heatmap" title={`Order book heatmap - ${coin(symbol)}`} right={(
      <select aria-label="Colour palette" value={palette} onChange={(e) => setPalette(e.target.value)} className="focus-ring min-h-[44px] rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-300">
        {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    )}>
      <p className="mb-2 text-xs text-amber-400">Built from depth snapshots since the collector started; not historical. Resting orders can be cancelled (spoofing), so size on the book is not size that will trade.</p>
      {ok && data.stale && <StaleNote at={data.generatedAt} />}
      {ok && !data.stale && error && <StaleNote />}
      {data?.source && data.source !== 'binance-futures' && <p className="mb-2 text-xs text-amber-400">Order book from {data.source} perpetuals (Binance futures unavailable from this server); sizes differ from Binance.</p>}
      {collecting ? (
        <Notice><span role="status">{data.status === 'thin' ? THIN_TEXT : data.status === 'unavailable' ? 'Order book data is unavailable from this server right now.' : `${collectingText(data.collectedMs)}. The first picture appears after a few snapshots.`}</span></Notice>
      ) : !ok ? (
        loading ? <LoadingBlock height={H} /> : <Notice tone={error ? 'error' : 'muted'}>{notice || 'No order book data yet.'}</Notice>
      ) : (
        <>
          <div ref={wrap} className="relative">
            <canvas ref={canvas} role="img" aria-label={label} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} className="block touch-pan-y" />
            {hover && (
              <div className="pointer-events-none absolute top-2 z-10 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200" style={{ left: Math.max(4, Math.min(hover.x + 12, hover.w - 190)) }}>
                <div>{fmtTime(hover.cell.time)}</div>
                <div>{fmtMarketPrice(hover.cell.priceLo)} to {fmtMarketPrice(hover.cell.priceHi)}</div>
                <div>Resting size {hover.cell.usd > 0 ? fmtUsd(hover.cell.usd) : 'none seen'}</div>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span>Low</span><span className="h-2 w-28 rounded" style={{ background: rampCss(palette) }} aria-hidden="true" /><span>{fmtUsd(data.max)}+ (99th percentile cell)</span>
            <span><i className="mr-1 inline-block h-0.5 w-3 bg-cyan-400 align-middle" />Mid price</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {collectingText(data.collectedMs)} ({data.samples} snapshots, one every {data.sampleMs / 1000} s, at most {Math.round(data.retainMs / 3600e3)} h kept). Price buckets are {fmtMarketPrice(data.priceStep)} wide and cover only the levels one snapshot returns, so a wide move leaves the picture. Empty means no resting size seen.
          </p>
        </>
      )}
    </Panel>
  );
};

export default OrderBookHeatmap;
