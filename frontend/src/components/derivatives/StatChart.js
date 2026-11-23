import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

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
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(148, 163, 184, 0.12)' } },
      rightPriceScale: { borderColor: '#334155' },
      leftPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
    });
    chart.current = c;
    added.current = [];
    layout.current = null;
    fitted.current = false;
    return () => { c.remove(); chart.current = null; };
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
