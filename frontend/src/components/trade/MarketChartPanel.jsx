import React from 'react';
import Panel from '../ui/Panel';
import SegTabs from '../ui/SegTabs';
import CandleChart from './CandleChart';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'].map((id) => ({ id, label: id }));

const Message = ({ tone = 'text-slate-400', children }) => (
  <div className={`absolute inset-0 flex items-center justify-center text-sm ${tone}`}>{children}</div>
);

const MarketChartPanel = ({ ticker, interval, onInterval, candles, reloadSeq, error, ready, onRetry, className = '' }) => (
  <Panel
    title="Chart"
    className={className}
    right={<SegTabs tabs={TIMEFRAMES} active={interval} onChange={onInterval} label="Timeframe" />}
    bodyClassName="relative min-h-[320px] p-1.5 pt-0"
  >
    {error === 'no_market' ? (
      <Message>No perpetual futures market for {ticker}</Message>
    ) : error ? (
      <Message tone="text-rose-300">
        <span>Unable to load futures data.</span>
        <button type="button" onClick={onRetry} className="ml-3 rounded-md border border-rose-300/40 px-2 py-0.5 text-xs hover:bg-rose-300/10">Retry</button>
      </Message>
    ) : !ready || candles.length === 0 ? (
      <Message tone="text-slate-500">Loading candles…</Message>
    ) : (
      <CandleChart key={`${ticker}-${interval}`} candles={candles} reloadSeq={reloadSeq} label={`${ticker} ${interval} candlestick chart`} />
    )}
  </Panel>
);

export default MarketChartPanel;
