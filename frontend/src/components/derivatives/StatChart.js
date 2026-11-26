import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

// Plain wheel = page scroll (library default would capture it); Ctrl/Cmd+wheel zooms the time axis around the pointer. Returns the remover.
export function ctrlWheelZoom(node, c) {
  const onWheel = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const ts = c.timeScale();
    const r = ts.getVisibleLogicalRange?.();
    if (!r) return;
    e.preventDefault();
    const b = node.getBoundingClientRect();
    const at = r.from + ((r.to - r.from) * (e.clientX - b.left)) / Math.max(1, b.width);
    const f = Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.01); // >1 zooms out
    ts.setVisibleLogicalRange({ from: at - (at - r.from) * f, to: at + (r.to - at) * f });
  };
  node.addEventListener('wheel', onWheel, { passive: false });
  return () => node.removeEventListener('wheel', onWheel);
}

// Chart options shared by every pane; the page must keep scrolling over the chart (no wheel capture, no vertical touch drag).
export const baseChartOptions = {
  autoSize: true,
  layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
  grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(148, 163, 184, 0.12)' } },
  rightPriceScale: { borderColor: '#334155' },
  leftPriceScale: { borderColor: '#334155' },
  timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
  handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
};

// One shared lightweight-charts wrapper. series: [{kind:'line'|'histogram', data:[{time,value,color?}], color, scale?:'left'}]
// Series are created once per layout (kind/scale/color); polls only setData on them and the view is fitted on first data.
// fill: container takes 100% of its parent (maximised card). Height is only the container's CSS: autoSize
// tracks it, so toggling fill never recreates the chart.
const StatChart = ({ series, height = 180, fill = false, label }) => {
  const el = useRef(null);
  const chart = useRef(null);
  const added = useRef([]);
  const layout = useRef(null);
  const fitted = useRef(false);

  useEffect(() => {
    const c = createChart(el.current, baseChartOptions);
    chart.current = c;
    added.current = [];
    layout.current = null;
    fitted.current = false;
    const node = el.current;
    const offWheel = ctrlWheelZoom(node, c);
    const onDbl = () => c.timeScale().fitContent();
    node.addEventListener('dblclick', onDbl);
    return () => { offWheel(); node.removeEventListener('dblclick', onDbl); c.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const sig = series.map((s) => `${s.kind}|${s.scale || ''}|${s.color}`).join();
    if (layout.current !== sig) {
      added.current.forEach((s) => c.removeSeries(s));
      added.current = series.map((s) => {
        const opts = { color: s.color, priceScaleId: s.scale || 'right', lastValueVisible: false, priceLineVisible: false };
        return s.kind === 'histogram' ? c.addHistogramSeries(opts) : c.addLineSeries({ ...opts, lineWidth: 2 });
      });
      layout.current = sig;
      c.priceScale('left').applyOptions({ visible: series.some((s) => s.scale === 'left') });
    }
    series.forEach((s, i) => added.current[i].setData(s.data));
    if (!fitted.current && series.some((s) => s.data.length)) {
      c.timeScale().fitContent();
      fitted.current = true;
    }
  }, [series]);

  return <div ref={el} role="img" aria-label={label} style={{ height: fill ? '100%' : height }} />;
};

export default StatChart;
