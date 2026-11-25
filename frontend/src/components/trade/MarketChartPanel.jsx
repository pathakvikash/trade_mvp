import React from 'react';
import Panel from '../ui/Panel';
import SegTabs from '../ui/SegTabs';
import { Tip } from '../ui/Tooltip';
import CandleChart from './CandleChart';
import AlertsPanel from '../alerts/AlertsPanel';
import { sourceNote } from '../ui/sourceNote';
import MaximizeButton, { MaximizeBackdrop } from '../ui/MaximizeButton';
import useMaximize from '../ui/useMaximize';
import usePersistedState from '../../lib/usePersistedState';
import useLiqLevels from '../../lib/useLiqLevels';
import { LiqToggle, LiqChip } from './LiqLevelsControl';

const TF_NAME = { m: 'minute', h: 'hour', d: 'day' };
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'].map((id) => ({ id, label: id, title: `${parseInt(id, 10)}-${TF_NAME[id.slice(-1)]} candles` }));

const LEGEND = [['entry', 'Entry', '#22d3ee'], ['liq', 'Liq', '#f43f5e'], ['tp', 'TP', '#34d399'], ['sl', 'SL', '#fb923c']];

// Live ticks only fold into an existing 1m candle (futuresStore / candleSync), so other timeframes stay empty.
const noHistory = (interval) => (interval === '1m'
  ? 'No candle history from this server; live candles will build up'
  : 'No candle history from this server. Switch to 1m for live candles.');

const Message = ({ tone = 'text-slate-400', children }) => (
  <div className={`absolute inset-0 flex items-center justify-center text-sm ${tone}`}>{children}</div>
);

const MarketChartPanel = ({
  ticker, interval, onInterval, candles, reloadSeq, error, ready, onRetry, klineSource,
  view = 'chart', onView, alertsSymbol, unread = 0, className = '', lines, overlays, markers, strategyChip, headerExtra, liqSymbol,
}) => {
  const mx = useMaximize();
  const alertsView = view === 'alerts';
  const [liqOn, setLiqOn] = usePersistedState('chart.liqLevels', false, { validate: (v) => typeof v === 'boolean' });
  const liq = useLiqLevels(liqSymbol, liqOn && !!liqSymbol && !alertsView);
  const legend = LEGEND.filter(([k]) => (lines || []).some((l) => l.kind === k)).map(([k, t, fb]) => [k, t, lines.find((l) => l.kind === k).color || fb]);
  return (
    <>
    <MaximizeBackdrop max={mx.max} onClose={mx.exit} />
    <Panel
      title={alertsView ? 'Alerts' : 'Chart'}
      className={`${className} ${mx.panelClass}`}
      {...mx.panelProps}
      right={
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {headerExtra}
          <Tip text={alertsView ? 'Back to the chart' : 'Price alerts for this symbol'}>
          <button
            type="button"
            aria-pressed={alertsView}
            onClick={() => onView?.(alertsView ? 'chart' : 'alerts')}
            className={`focus-ring rounded-md border px-2 py-1 text-xs font-medium min-h-[36px] sm:min-h-0 ${
              alertsView ? 'border-cyan-400/60 text-cyan-300' : 'border-slate-700 text-slate-300 hover:bg-slate-900'
            }`}
          >
            Alerts
            {unread > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-400 px-1 text-[10px] font-semibold tabular-nums text-slate-950" aria-label={`${unread} unread`}>{unread}</span>
            )}
          </button>
          </Tip>
          {liqSymbol && !alertsView && <LiqToggle on={liqOn} onToggle={() => setLiqOn(!liqOn)} />}
          <SegTabs tabs={TIMEFRAMES} active={interval} onChange={onInterval} label="Timeframe" className="[&_button]:min-h-[36px] sm:[&_button]:min-h-0" />
          <MaximizeButton max={mx.max} onToggle={mx.toggle} />
        </div>
      }
      bodyClassName={alertsView ? 'relative min-h-[320px] xl:min-h-0 p-0' : 'relative min-h-[320px] xl:min-h-0 p-1.5 pt-0'}
    >
      {alertsView ? (
        <AlertsPanel symbol={alertsSymbol} />
      ) : error === 'no_market' ? (
        <Message>No perpetual futures market for {ticker}</Message>
      ) : error ? (
        <Message tone="text-rose-300">
          <span>Unable to load futures data.</span>
          <button type="button" onClick={onRetry} className="ml-3 rounded-md border border-rose-300/40 px-2 py-0.5 text-xs hover:bg-rose-300/10">Retry</button>
        </Message>
      ) : candles.length === 0 && ready && klineSource === 'unavailable' ? (
        <Message tone="text-slate-500">{noHistory(interval)}</Message>
      ) : !ready || candles.length === 0 ? (
        <Message tone="text-slate-500">Loading candles…</Message>
      ) : (
        <>
          {sourceNote(klineSource) && <div className="pointer-events-none absolute left-2 top-1 z-10 text-[10px] text-slate-500">{sourceNote(klineSource)}</div>}
          {legend.length > 0 && (
            <div className="pointer-events-none absolute right-16 top-1 z-10 hidden gap-x-3 text-[10px] text-slate-400 sm:flex" aria-label="Chart line legend">
              {legend.map(([k, t, c]) => (
                <span key={k} className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c }} />{t}</span>
              ))}
            </div>
          )}
          {liqOn && liqSymbol && <LiqChip liq={liq} />}
          <CandleChart key={`${ticker}-${interval}`} candles={candles} reloadSeq={reloadSeq} label={`${ticker} ${interval} candlestick chart`} lines={lines} priceLines={liqOn ? liq.lines : undefined} overlays={overlays} markers={markers} strategyChip={strategyChip} />
        </>
      )}
    </Panel>
    </>
  );
};

export default MarketChartPanel;
