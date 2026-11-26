import React from 'react';
import usePolling from '../../lib/usePolling';
import ScrollArea from '../ui/ScrollArea';
import { LoadingBlock } from '../ui/Skeleton';
import { FUT, Notice, StaleNote, fmtMarketPrice, fmtTime, fmtUsd, is404 } from './shared';
import { TRADE_THRESHOLDS, filterTrades, thresholdLabel } from './cvdCalc';

const chip = (on) => `focus-ring min-h-[44px] min-w-[44px] shrink-0 rounded-md px-2 text-xs font-medium ${on ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`;
const when = (sec) => new Date(sec * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Buys vs sells of the last 60 s as a two-colour bar; coveredMs says how much of that minute the fetched trades really span.
export const FlowBar = ({ flow }) => {
  const tot = flow.buyUsd + flow.sellUsd;
  const buyPct = tot > 0 ? (flow.buyUsd / tot) * 100 : 50;
  return (
    <div data-testid="flow60" className="mb-2">
      <div className="flex justify-between text-[11px] tabular-nums"><span className="text-emerald-400">Buys {fmtUsd(flow.buyUsd)}</span><span className="text-rose-400">Sells {fmtUsd(flow.sellUsd)}</span></div>
      <div role="img" aria-label={`Taker buys ${buyPct.toFixed(0)} percent, sells ${(100 - buyPct).toFixed(0)} percent`} className="mt-1 flex h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="bg-emerald-500" style={{ width: `${buyPct}%` }} /><div className="bg-rose-500" style={{ width: `${100 - buyPct}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Net {flow.netUsd >= 0 ? '+' : '-'}{fmtUsd(Math.abs(flow.netUsd))} taker flow, last 60 s{flow.coveredMs < 59000 ? ` (trades fetched cover only the last ${Math.max(1, Math.round(flow.coveredMs / 1000))} s)` : ''}</p>
    </div>
  );
};

const Trades = ({ symbol, min, onMin }) => {
  const { data, error, loading } = usePolling(`${FUT}/cvd/${symbol}/trades?min=${min}`, 5000, undefined, undefined, true);
  const ok = !!data && data.symbol === symbol && data.available;
  const rows = ok ? filterTrades(data.items, min) : [];
  return (
    <div>
      <div role="group" aria-label="Trade size threshold" className="mb-2 flex gap-1 overflow-x-auto">
        {TRADE_THRESHOLDS.map((t) => <button key={t} type="button" aria-pressed={min === t} onClick={() => onMin(t)} className={chip(min === t)}>{`>=${thresholdLabel(t)}`}</button>)}
      </div>
      {ok && error && <StaleNote at={data.generatedAt} />}
      {data && data.available === false ? <Notice>Recent trades are unavailable from this source: {data.reason}</Notice>
        : !ok ? (loading ? <LoadingBlock height={160} /> : <Notice tone={error ? 'error' : 'muted'}>{is404(error) ? 'No perpetual market for this symbol.' : error ? 'Recent trades unavailable right now.' : 'No trades yet.'}</Notice>)
          : (
            <>
              <FlowBar flow={data.flow60} />
              {rows.length === 0 ? <Notice>No trade of {fmtUsd(min)} or more among the latest 1000.</Notice> : (
                <ScrollArea label="Large recent trades" footer={`${rows.length} trades from the latest 1000, newest first`}>
                  <table className="w-full min-w-[260px] text-xs tabular-nums">
                    <caption className="sr-only">Large recent trades</caption>
                    <thead className="sticky top-0 z-10 bg-slate-950 text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <tr><th scope="col" className="px-2 py-1 font-medium">Time</th><th scope="col" className="px-2 font-medium">Side</th><th scope="col" className="px-2 text-right font-medium">Price</th><th scope="col" className="px-2 text-right font-medium">USD</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.id} className="border-t border-slate-800/60 text-slate-200">
                          <td className="px-2 py-1 text-slate-400">{fmtTime(t.ts)}</td>
                          <td className={`px-2 py-1 ${t.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                          <td className="px-2 py-1 text-right">{fmtMarketPrice(t.price)}</td>
                          <td className="px-2 py-1 text-right">{fmtUsd(t.usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </>
          )}
      <p className="mt-2 text-[11px] text-slate-500">Binance USD-M futures trades; side is the taker's. Past trades, not advice.</p>
    </div>
  );
};

const Divergences = ({ list, lookback }) => (list.length === 0 ? <Notice>No divergence in the loaded candles.</Notice> : (
  <>
    <ScrollArea label="Detected divergences" footer={`${list.length} found, newest first`}>
      <table className="w-full min-w-[260px] text-xs tabular-nums">
        <caption className="sr-only">Detected divergences</caption>
        <thead className="sticky top-0 z-10 bg-slate-950 text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr><th scope="col" className="px-2 py-1 font-medium">Time</th><th scope="col" className="px-2 font-medium">Type</th><th scope="col" className="px-2 text-right font-medium">Price</th><th scope="col" className="px-2 text-right font-medium">CVD delta</th></tr>
        </thead>
        <tbody>
          {[...list].reverse().map((d) => (
            <tr key={`${d.time}-${d.type}`} className="border-t border-slate-800/60 text-slate-200">
              <td className="px-2 py-1 text-slate-400">{when(d.time)}</td>
              <td className={`px-2 py-1 ${d.type === 'bullish' ? 'text-emerald-400' : 'text-rose-400'}`}>{d.type === 'bullish' ? 'Bullish' : 'Bearish'}</td>
              <td className="px-2 py-1 text-right">{fmtMarketPrice(d.price)}</td>
              <td className="px-2 py-1 text-right">{d.cvdDelta >= 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(d.cvdDelta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
    <p className="mt-2 text-[11px] text-slate-500">Rule: price makes a new high (low) over the previous {lookback} candles while CVD does not make a new high (low) over the same candles. A description of the past, not a forecast.</p>
  </>
));

const CvdSide = ({ symbol, tab, onTab, min, onMin, divergences, lookback }) => (
  <div className="min-w-0">
    <div role="tablist" aria-label="CVD side panel" className="mb-2 flex gap-1">
      {[['trades', 'Live trades'], ['div', 'Divergences']].map(([id, name]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)} className={chip(tab === id)}>{name}</button>
      ))}
    </div>
    <div role="tabpanel">{tab === 'trades' ? <Trades symbol={symbol} min={min} onMin={onMin} /> : <Divergences list={divergences} lookback={lookback} />}</div>
  </div>
);

export default CvdSide;
