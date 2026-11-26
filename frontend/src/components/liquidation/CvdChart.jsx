import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { baseChartOptions, ctrlWheelZoom } from '../derivatives/StatChart';

// Stacked lightweight-charts panes (v4 has no panes): price on top, CVD lines, then optional delta / buy% / volume.
// All panes share one time grid (callers pass whitespace for gaps), so their logical ranges are interchangeable: zoom/pan in
// one is copied to the rest and the crosshair is mirrored. Plain wheel scrolls the page; Ctrl/Cmd+wheel zooms (ctrlWheelZoom).
const H = { price: 220, cvd: 180, delta: 90, ratio: 90, volume: 90 };
const NAME = { price: 'Price', cvd: 'CVD', delta: 'Delta', ratio: 'Taker buy %', volume: 'Volume' };
const UP = '#34d399';
const DOWN = '#fb7185';
const fmtV = (v) => (v == null ? '--' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v));

// grid: candles of the price source; lines: [{id,label,color,data}]; panes: {delta,ratio,volume}; markers: divergences or []
const CvdChart = ({ grid, lines, panes, markers, tooltip, resetKey, onRange, label, normalized }) => {
  const root = useRef(null);
  const live = useRef({ charts: [], series: {}, price: null });
  const [tip, setTip] = useState(null);
  const ids = ['price', 'cvd', ...['delta', 'ratio', 'volume'].filter((p) => panes[p])];
  const sig = `${ids.join()}|${lines.map((l) => `${l.id}${l.color}`).join()}`;
  const data = useRef({});
  data.current = { grid, lines };
  const cb = useRef(onRange);
  cb.current = onRange;
  const fitted = useRef(false);
  const keepRef = useRef(null); // visible range across a pane toggle

  useEffect(() => {
    const rows = [...root.current.querySelectorAll('[data-pane]')];
    const charts = rows.map((node, k) => createChart(node, {
      ...baseChartOptions,
      height: H[node.dataset.pane],
      autoSize: false,
      width: node.clientWidth || 300,
      rightPriceScale: { borderColor: '#334155', minimumWidth: 64 },
      timeScale: { ...baseChartOptions.timeScale, visible: k === rows.length - 1 },
    }));
    const series = {};
    charts.forEach((c, k) => {
      const id = rows[k].dataset.pane;
      if (id === 'price') series.price = c.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN, lastValueVisible: false, priceLineVisible: false });
      else if (id === 'cvd') {
        series.lines = data.current.lines.map((l) => c.addLineSeries({ color: l.color, lineWidth: 2, lastValueVisible: false, priceLineVisible: false }));
        series.lines[0]?.createPriceLine({ price: 0, color: '#475569', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      } else if (id === 'ratio') {
        series.ratio = c.addLineSeries({ color: '#94a3b8', lineWidth: 2, lastValueVisible: false, priceLineVisible: false });
        series.ratio.createPriceLine({ price: 50, color: '#475569', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      } else series[id] = c.addHistogramSeries({ lastValueVisible: false, priceLineVisible: false });
    });
    live.current = { charts, series, price: series.price };
    // zoom/pan sync (guard stops the copies from echoing back) + debounced report of the visible time range
    let busy = false;
    let timer;
    charts.forEach((c, k) => {
      c.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (busy || !r) return;
        busy = true;
        charts.forEach((o, j) => { if (j !== k) o.timeScale().setVisibleLogicalRange(r); });
        busy = false;
        clearTimeout(timer);
        timer = setTimeout(() => { const t = charts[0].timeScale().getVisibleRange?.(); if (t) cb.current?.({ from: Number(t.from), to: Number(t.to) }); }, 120);
      });
    });
    // crosshair mirror: the other panes get a vertical line at the same time (their own value there, else cleared)
    const paneSeries = (id) => (id === 'cvd' ? series.lines[0] : series[id]);
    const valueAt = (id, i) => {
      const g = data.current.grid[i];
      if (!g) return undefined;
      if (id === 'price') return g.close;
      if (id === 'cvd') return data.current.lines[0]?.data[i]?.value;
      if (id === 'delta') return g.delta;
      if (id === 'volume') return g.volume ?? g.buy + g.sell;
      return g.buy + g.sell > 0 ? (g.buy / (g.buy + g.sell)) * 100 : undefined;
    };
    charts.forEach((c, k) => {
      c.subscribeCrosshairMove((p) => {
        const i = p.time ? data.current.grid.findIndex((x) => x.time === p.time) : -1;
        charts.forEach((o, j) => {
          if (j === k) return;
          const id = rows[j].dataset.pane;
          const v = i >= 0 ? valueAt(id, i) : undefined;
          if (v != null && paneSeries(id)) o.setCrosshairPosition(v, p.time, paneSeries(id)); else o.clearCrosshairPosition();
        });
        setTip((t) => (t?.time === (p.time || null) ? t : { time: p.time || null }));
      });
    });
    const offs = rows.map((n, k) => ctrlWheelZoom(n, charts[k]));
    const onDbl = () => charts.forEach((c) => c.timeScale().fitContent());
    rows.forEach((n) => n.addEventListener('dblclick', onDbl));
    const resize = () => charts.forEach((c, k) => c.applyOptions({ width: rows[k].clientWidth }));
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    ro?.observe(root.current);
    window.addEventListener('resize', resize);
    fitted.current = false;
    return () => {
      keepRef.current = charts[0]?.timeScale().getVisibleLogicalRange();
      clearTimeout(timer); ro?.disconnect(); window.removeEventListener('resize', resize);
      offs.forEach((f) => f()); rows.forEach((n) => n.removeEventListener('dblclick', onDbl));
      charts.forEach((c) => c.remove());
      live.current = { charts: [], series: {}, price: null };
    };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // data
  useEffect(() => {
    const { series, charts } = live.current;
    if (!series.price) return;
    series.price.setData(grid.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    series.price.setMarkers((markers || []).map((m) => ({ time: m.time, position: m.type === 'bearish' ? 'aboveBar' : 'belowBar', shape: m.type === 'bearish' ? 'arrowDown' : 'arrowUp', color: m.type === 'bearish' ? DOWN : UP, text: m.type === 'bearish' ? 'Bear div' : 'Bull div' })).sort((a, b) => a.time - b.time));
    lines.forEach((l, i) => series.lines[i]?.setData(l.data));
    series.delta?.setData(grid.map((c) => ({ time: c.time, value: c.delta, color: c.delta >= 0 ? UP : DOWN })));
    series.volume?.setData(grid.map((c) => ({ time: c.time, value: c.volume ?? c.buy + c.sell, color: c.delta >= 0 ? 'rgba(52,211,153,0.6)' : 'rgba(251,113,133,0.6)' })));
    series.ratio?.setData(grid.map((c) => (c.buy + c.sell > 0 ? { time: c.time, value: (c.buy / (c.buy + c.sell)) * 100 } : { time: c.time })));
    if (!fitted.current && grid.length) {
      const k = keepRef.current;
      if (k) charts[0].timeScale().setVisibleLogicalRange(k); else charts[0].timeScale().fitContent();
      fitted.current = true;
    }
  }, [grid, lines, markers, sig]);

  // Reset view button
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    live.current.charts[0]?.timeScale().fitContent();
  }, [resetKey]);

  const g = tip?.time ? grid.find((c) => c.time === tip.time) : null;
  const at = (l) => l.data.find((p) => p.time === tip.time)?.value;
  return (
    <div ref={root} role="img" aria-label={label} className="relative">
      {ids.map((id) => (
        <div key={id} className="relative">
          <span className="pointer-events-none absolute left-1 top-0.5 z-10 text-[10px] uppercase tracking-wider text-slate-500">{NAME[id]}{id === 'cvd' && normalized ? ' (normalized)' : ''}</span>
          <div data-pane={id} style={{ height: H[id] }} />
        </div>
      ))}
      {tooltip && g && (
        <div data-testid="cvd-tooltip" className="pointer-events-none absolute right-16 top-1 z-20 rounded-md border border-slate-700 bg-slate-950/90 px-2 py-1 text-[11px] tabular-nums text-slate-200">
          <div className="text-slate-400">{new Date(g.time * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          <div>O {g.open} H {g.high} L {g.low} C {g.close}</div>
          <div>Delta {fmtV(g.delta)}</div>
          {lines.map((l) => <div key={l.id} style={{ color: l.color }}>{l.label} CVD {at(l) == null ? '--' : normalized ? at(l).toFixed(2) : fmtV(at(l))}</div>)}
        </div>
      )}
    </div>
  );
};

export default CvdChart;
