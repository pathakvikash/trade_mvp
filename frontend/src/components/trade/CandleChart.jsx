import React, { useEffect, useRef, useState } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';
import { needsFullReload } from './candleSync';
import { fmtCompact, fmtMarketPrice } from '../ui/fmt';
import { buildHeatBitmap, heatRect, linearMap } from './heatOverlay';

const UP = '#34d399';
const DOWN = '#fb7185';
const toVolume = (c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(52, 211, 153, 0.35)' : 'rgba(251, 113, 133, 0.35)' });
const precisionFor = (p) => (p >= 1000 ? 2 : p >= 1 ? 4 : 6);

// Candlestick + volume chart with an OHLC readout. Remount (key) when symbol or timeframe changes.
// Price lines never feed lightweight-charts' autoscale (4.2.x only reads series data), so a far-off liq line can't squash candles.
const lineOpts = (l) => ({
  price: l.price, color: l.color, title: l.title, lineWidth: l.kind === 'entry' ? 2 : 1,
  lineStyle: l.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true,
});

// Generic lines (liquidation levels): width/colour come from the caller; the axis label shows only with a title.
const extraOpts = (l) => ({
  price: l.price, color: l.color, title: l.title || '', lineWidth: l.width || 1,
  lineStyle: l.style === 'solid' ? LineStyle.Solid : LineStyle.Dashed, axisLabelVisible: !!l.title,
});

// Strategy marker kinds (evaluate API) -> chart marker look.
const MARKER = {
  entry_long: { position: 'belowBar', shape: 'arrowUp', color: UP, text: 'L' },
  exit_long: { position: 'aboveBar', shape: 'arrowDown', color: '#fbbf24', text: 'xL' },
  entry_short: { position: 'aboveBar', shape: 'arrowDown', color: DOWN, text: 'S' },
  exit_short: { position: 'belowBar', shape: 'arrowUp', color: '#fbbf24', text: 'xS' },
  open_long: { position: 'aboveBar', shape: 'square', color: '#94a3b8', text: 'open' }, // still open on the last bar: not counted in stats
  open_short: { position: 'belowBar', shape: 'square', color: '#94a3b8', text: 'open' },
  stop: { position: 'aboveBar', shape: 'circle', color: DOWN, text: 'SL' },
  target: { position: 'aboveBar', shape: 'circle', color: UP, text: 'TP' },
};
const toMarkers = (ms) => (ms || []).filter((m) => MARKER[m.kind]).map((m) => ({ time: m.time, ...MARKER[m.kind] })).sort((a, b) => a.time - b.time);
const lineData = (o) => (o.data || []).filter((p) => Number.isFinite(p.value));

// Time/price -> pixel maps for the heat, anchored on real chart coordinates (two candles near the visible edges, two prices) and
// extended linearly, so columns/rows outside the data or the screen (null coordinates) still land on the right axis position.
function heatMaps(chart, candle, cs, d) {
  const n = cs.length;
  const vr = chart.timeScale().getVisibleLogicalRange();
  if (!vr || n < 2) return null;
  const i0 = Math.min(n - 2, Math.max(0, Math.floor(vr.from)));
  const i1 = Math.max(i0 + 1, Math.min(n - 1, Math.ceil(vr.to)));
  const xOf = linearMap(cs[i0].time * 1000, chart.timeScale().timeToCoordinate(cs[i0].time), cs[i1].time * 1000, chart.timeScale().timeToCoordinate(cs[i1].time));
  const pTop = d.priceMin + d.rows * d.priceStep;
  const yOf = linearMap(d.priceMin, candle.priceToCoordinate(d.priceMin), pTop, candle.priceToCoordinate(pTop));
  return xOf && yOf ? { xOf, yOf } : null;
}

const CandleChart = ({ candles, reloadSeq, label, lines, priceLines, overlays, markers, strategyChip, heat }) => {
  const el = useRef(null);
  const series = useRef(null); // { candle, volume }
  const count = useRef(0);
  const seq = useRef(reloadSeq);
  const entryLines = useRef(new Map()); // id -> { line, sig }
  const extraLines = useRef(new Map()); // same, for the `priceLines` prop (liquidation levels)
  const overlaySeries = useRef(new Map()); // id -> { s, sig }
  const hadMarkers = useRef(false);
  const byTime = useRef(new Map()); // time -> candle, for the crosshair readout
  const [hover, setHover] = useState(null);
  // Liquidation heat behind the candles: `heat` = { data, palette, lens, intensity, opacity } or absent. Repaints are rAF-throttled,
  // run only on a trigger (pan/zoom, resize, data/settings change, crosshair move = price-axis drags) and skip when the geometry is unchanged.
  const heatCanvas = useRef(null);
  const heatRef = useRef(null);
  const bitmap = useRef(null);
  const candlesRef = useRef(candles);
  const raf = useRef(0);
  const lastSig = useRef('');
  const paintHeat = useRef(() => {});
  const kickHeat = useRef(() => {});
  candlesRef.current = candles;

  useEffect(() => {
    const chart = createChart(el.current, {
      autoSize: true,
      // phones: a vertical drag on the chart scrolls the page; horizontal drags and pinch still pan/zoom the chart
      handleScroll: { vertTouchDrag: false },
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(148, 163, 184, 0.08)' } },
      rightPriceScale: { borderColor: '#1e293b', scaleMargins: { top: 0.08, bottom: 0.25 } },
      timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
    });
    const candle = chart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false,
    });
    const volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    chart.subscribeCrosshairMove((p) => {
      setHover(p.time ? byTime.current.get(p.time) || null : null);
    });
    series.current = { candle, volume, chart };
    count.current = 0;
    paintHeat.current = () => {
      raf.current = 0;
      const cv = heatCanvas.current;
      const h = heatRef.current;
      if (!cv || !h || !bitmap.current) return;
      const w = Math.floor(chart.timeScale().width());
      const ph = Math.floor(el.current.clientHeight - chart.timeScale().height());
      const maps = w > 0 && ph > 0 ? heatMaps(chart, candle, candlesRef.current, h.data) : null;
      const r = maps && heatRect(h.data, maps.xOf, maps.yOf, w, ph);
      const dpr = window.devicePixelRatio || 1;
      const sig = r ? [w, ph, dpr, h.opacity, ...Object.values(r).map((v) => Math.round(v * 4))].join() : 'none';
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(ph * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${ph}px`;
      const ctx = cv.getContext('2d');
      if (!ctx || !r) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = r.dw < r.sw || r.dh < r.sh; // downsample when cells are smaller than a pixel
      ctx.globalAlpha = h.opacity;
      ctx.drawImage(bitmap.current, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    };
    const kick = () => { if (!raf.current && heatRef.current) raf.current = requestAnimationFrame(() => paintHeat.current()); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(kick);
    chart.subscribeCrosshairMove(kick);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { lastSig.current = ''; kick(); }) : null;
    ro?.observe(el.current);
    kickHeat.current = (force) => { if (force) lastSig.current = ''; kick(); };
    const pl = entryLines.current;
    const xl = extraLines.current;
    const os = overlaySeries.current;
    return () => {
      ro?.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      kickHeat.current = () => {};
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(kick);
      chart.remove();
      pl.clear();
      xl.clear();
      os.clear();
      series.current = null;
    };
  }, []);

  useEffect(() => {
    if (!series.current) return;
    const { candle, volume } = series.current;
    if (candles.length === 0) {
      count.current = 0;
      return;
    }
    const last = candles[candles.length - 1];
    // Full reload on seed/backfill; otherwise just push the newest candle
    // REST reloads (reloadSeq) replace the series: a finished bucket's final OHLC/volume must reach the chart
    if (seq.current !== reloadSeq || needsFullReload(count.current, candles.length)) {
      seq.current = reloadSeq;
      const precision = precisionFor(last.close);
      candle.applyOptions({ priceFormat: { type: 'custom', formatter: fmtMarketPrice, minMove: 10 ** -precision } });
      candle.setData(candles);
      volume.setData(candles.map(toVolume));
      byTime.current = new Map(candles.map((c) => [c.time, c]));
    } else {
      candle.update(last);
      volume.update(toVolume(last));
      byTime.current.set(last.time, last);
      if (byTime.current.size > candles.length + 50) byTime.current = new Map(candles.map((c) => [c.time, c]));
    }
    count.current = candles.length;
  }, [candles, reloadSeq]);

  // heat settings/data changed: rebuild the bitmap (one pixel per cell) and repaint; new candles also move the time axis
  const hd = heat?.data;
  useEffect(() => {
    heatRef.current = heat || null;
    bitmap.current = null;
    if (heat && hd && hd.cols > 0) {
      const top = (hd.max * heat.intensity[1]) / 100;
      const bottom = (hd.max * heat.intensity[0]) / 100;
      bitmap.current = buildHeatBitmap(hd, bottom, top, heat.palette, heat.lens);
    }
    kickHeat.current(true);
  }, [hd, heat?.palette, heat?.lens, heat?.intensity, heat?.opacity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { kickHeat.current(false); }, [candles]);

  // Reconcile by id: create / applyOptions in place (no recreate, no zoom reset) / remove.
  const reconcile = (map, list, opts) => {
    const { candle } = series.current;
    const next = new Map((list || []).map((l) => [l.id, l]));
    map.forEach(({ line }, id) => {
      if (!next.has(id)) { candle.removePriceLine(line); map.delete(id); }
    });
    next.forEach((l, id) => {
      const sig = JSON.stringify(opts(l));
      const cur = map.get(id);
      if (!cur) map.set(id, { line: candle.createPriceLine(opts(l)), sig });
      else if (cur.sig !== sig) { cur.line.applyOptions(opts(l)); cur.sig = sig; }
    });
  };
  /* eslint-disable react-hooks/exhaustive-deps -- reconcile only reads refs */
  useEffect(() => { if (series.current) reconcile(entryLines.current, lines, lineOpts); }, [lines]);
  useEffect(() => { if (series.current) reconcile(extraLines.current, priceLines, extraOpts); }, [priceLines]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Strategy overlays: line series reconciled by id on the same chart (no remount, zoom kept).
  useEffect(() => {
    if (!series.current) return;
    const { chart } = series.current;
    const map = overlaySeries.current;
    const next = new Map((overlays || []).map((o) => [o.id, o]));
    map.forEach(({ s }, id) => {
      if (!next.has(id)) { chart.removeSeries(s); map.delete(id); }
    });
    next.forEach((o, id) => {
      const d = lineData(o);
      const color = o.color || '#22d3ee';
      const sig = `${color}|${d.length}|${d[0]?.time}|${d[d.length - 1]?.time}|${d[d.length - 1]?.value}`;
      const cur = map.get(id);
      if (!cur) {
        const s = chart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData(d);
        map.set(id, { s, sig });
      } else if (cur.sig !== sig) {
        cur.s.applyOptions({ color });
        cur.s.setData(d);
        cur.sig = sig;
      }
    });
  }, [overlays]);

  useEffect(() => {
    if (!series.current) return;
    const m = toMarkers(markers);
    if (!m.length && !hadMarkers.current) return;
    series.current.candle.setMarkers(m);
    hadMarkers.current = m.length > 0;
  }, [markers]);

  const last = candles[candles.length - 1];
  const shown = hover || last;
  const up = shown && shown.close >= shown.open;

  return (
    <div className="absolute inset-0">
      {heat && <canvas ref={heatCanvas} aria-hidden="true" data-testid="heat-canvas" className="pointer-events-none absolute left-0 top-0" />}
      <div ref={el} className="relative h-full w-full" role="img" aria-label={`${label}${last ? `, last close ${fmtMarketPrice(last.close)}` : ''}`} />
      {shown && (
        <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-slate-400" aria-label="Candle OHLC">
          <span>O <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtMarketPrice(shown.open)}</b></span>
          <span>H <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtMarketPrice(shown.high)}</b></span>
          <span>L <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtMarketPrice(shown.low)}</b></span>
          <span>C <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtMarketPrice(shown.close)}</b></span>
          <span>Vol <b className="text-slate-300">{fmtCompact(shown.volume)}</b></span>
        </div>
      )}
      {strategyChip && <div className="absolute bottom-1 left-2 z-10 max-w-[calc(100%-1rem)]">{strategyChip}</div>}
    </div>
  );
};

export default CandleChart;
