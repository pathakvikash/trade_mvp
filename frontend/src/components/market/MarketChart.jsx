import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import Panel from '../ui/Panel';
import SegTabs from '../ui/SegTabs';
import usePersistedState from '../../lib/usePersistedState';
import CandleChart from '../trade/CandleChart';
import MaximizeButton, { MaximizeBackdrop } from '../ui/MaximizeButton';
import useMaximize from '../ui/useMaximize';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'].map((id) => ({ id, label: id }));
const CHART_TYPES = [{ id: 'candles', label: 'Candles' }, { id: 'line', label: 'Line' }];
const UP = '#34d399';
const DOWN = '#fb7185';

// Area view of the same candles: closes as a line with a gradient fill, same grid and axis colours as CandleChart.
const AreaChart = ({ candles, label }) => {
  const el = useRef(null);
  const series = useRef(null);

  useEffect(() => {
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#94a3b8', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(148, 163, 184, 0.08)' } },
      rightPriceScale: { borderColor: '#1e293b', scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false },
    });
    series.current = chart.addAreaSeries({ lineWidth: 2, priceLineVisible: false });
    return () => {
      chart.remove();
      series.current = null;
    };
  }, []);

  useEffect(() => {
    if (!series.current || candles.length === 0) return;
    const first = candles[0];
    const last = candles[candles.length - 1];
    const up = last.close >= first.open;
    const rgb = up ? '52, 211, 153' : '251, 113, 133';
    series.current.applyOptions({ lineColor: up ? UP : DOWN, topColor: `rgba(${rgb}, 0.28)`, bottomColor: `rgba(${rgb}, 0)` });
    series.current.setData(candles.map((c) => ({ time: c.time, value: c.close })));
  }, [candles]);

  return (
    <div className="absolute inset-0">
      <div ref={el} className="h-full w-full" role="img" aria-label={label} />
    </div>
  );
};

const Message = ({ tone = 'text-slate-400', children }) => (
  <div className={`absolute inset-0 flex items-center justify-center gap-2 text-sm ${tone}`}>{children}</div>
);

// Chart panel for the Markets page: candles (CandleChart, with OHLC readout) or a line view, plus timeframes 1m..1d.
const MarketChart = ({ ticker, interval, onInterval, candles, reloadSeq, error, ready, onRetry, className = '' }) => {
  const mx = useMaximize();
  const [type, setType] = usePersistedState('market.chartType', 'candles', { validate: (v) => CHART_TYPES.some((t) => t.id === v) });

  let body;
  if (error === 'no_market') {
    body = <Message>No perpetual futures market for {ticker}</Message>;
  } else if (error) {
    body = (
      <Message tone="text-rose-300">
        <span>Unable to load futures data.</span>
        <button type="button" onClick={onRetry} className="focus-ring ml-3 rounded-md border border-rose-300/40 px-2 py-0.5 text-xs hover:bg-rose-300/10">Retry</button>
      </Message>
    );
  } else if (!ready || candles.length === 0) {
    body = (
      <Message tone="text-slate-500">
        <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
        Loading candles…
      </Message>
    );
  } else if (type === 'line') {
    body = <AreaChart key={`${ticker}-${interval}`} candles={candles} label={`${ticker} ${interval} line chart`} />;
  } else {
    body = <CandleChart key={`${ticker}-${interval}`} candles={candles} reloadSeq={reloadSeq} label={`${ticker} ${interval} candlestick chart`} />;
  }

  return (
    <>
    <MaximizeBackdrop max={mx.max} onClose={mx.exit} />
    <Panel
      title="Chart"
      className={`${className} ${mx.panelClass}`}
      {...mx.panelProps}
      bodyClassName="relative min-h-[320px] xl:min-h-0 p-1.5 pt-0"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <SegTabs tabs={CHART_TYPES} active={type} onChange={setType} label="Chart type" />
          <SegTabs tabs={TIMEFRAMES} active={interval} onChange={onInterval} label="Timeframe" />
          <MaximizeButton max={mx.max} onToggle={mx.toggle} />
        </div>
      }
    >
      {body}
    </Panel>
    </>
  );
};

export default MarketChart;
