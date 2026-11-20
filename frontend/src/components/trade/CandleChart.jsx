import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { needsFullReload } from './candleSync';
import { fmtCompact, fmtPrice } from '../ui/fmt';

const UP = '#34d399';
const DOWN = '#fb7185';
const toVolume = (c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(52, 211, 153, 0.35)' : 'rgba(251, 113, 133, 0.35)' });
const precisionFor = (p) => (p >= 1000 ? 2 : p >= 1 ? 4 : 6);

// Candlestick + volume chart with an OHLC readout. Remount (key) when symbol or timeframe changes.
const CandleChart = ({ candles, reloadSeq, label }) => {
  const el = useRef(null);
  const series = useRef(null); // { candle, volume }
  const count = useRef(0);
  const seq = useRef(reloadSeq);
  const byTime = useRef(new Map()); // time -> candle, for the crosshair readout
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const chart = createChart(el.current, {
      autoSize: true,
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
    series.current = { candle, volume };
    count.current = 0;
    return () => {
      chart.remove();
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
      candle.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } });
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

  const last = candles[candles.length - 1];
  const shown = hover || last;
  const up = shown && shown.close >= shown.open;

  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="img" aria-label={`${label}${last ? `, last close ${fmtPrice(last.close)}` : ''}`} />
      {shown && (
        <div className="pointer-events-none absolute left-2 top-1 z-10 flex flex-wrap gap-x-3 text-[11px] tabular-nums text-slate-400" aria-label="Candle OHLC">
          <span>O <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtPrice(shown.open)}</b></span>
          <span>H <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtPrice(shown.high)}</b></span>
          <span>L <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtPrice(shown.low)}</b></span>
          <span>C <b className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtPrice(shown.close)}</b></span>
          <span>Vol <b className="text-slate-300">{fmtCompact(shown.volume)}</b></span>
        </div>
      )}
    </div>
  );
};

export default CandleChart;
