import React, { useEffect, useRef, useState } from 'react';
import { createChart, LineStyle } from 'lightweight-charts';
import { needsFullReload } from './candleSync';
import { fmtCompact, fmtMarketPrice } from '../ui/fmt';

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

const CandleChart = ({ candles, reloadSeq, label, lines, priceLines, overlays, markers, strategyChip }) => {
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
    const pl = entryLines.current;
    const xl = extraLines.current;
    const os = overlaySeries.current;
    return () => {
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
      <div ref={el} className="h-full w-full" role="img" aria-label={`${label}${last ? `, last close ${fmtMarketPrice(last.close)}` : ''}`} />
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
