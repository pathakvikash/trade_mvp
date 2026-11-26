import React, { useMemo } from 'react';
import usePersistedState from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import StatChart from '../derivatives/StatChart';
import { LoadingBlock } from '../ui/Skeleton';
import { Notice, Panel, StaleNote, FUT, coin, fmtPct, fmtPrice, is404 } from './shared';
import { CVD_RANGES, cvdRead } from './cvdCalc';

const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);

// Cumulative volume delta (taker buy minus taker sell, base coin) under the candle close. Real Binance futures taker volume only.
const Cvd = ({ symbol }) => {
  const [range, setRange] = usePersistedState('liquidation.cvdRange', '24h', { validate: (v) => CVD_RANGES.some((r) => r.id === v) });
  const { data, error, loading } = usePolling(`${FUT}/cvd/${symbol}?range=${range}`, 30000);
  const ok = data && data.available && data.candles?.length > 0;
  const series = useMemo(() => (ok ? [
    { kind: 'line', color: '#64748b', scale: 'left', data: data.candles.map((c) => ({ time: c.time, value: c.close })) },
    { kind: 'line', color: '#22d3ee', data: data.candles.map((c) => ({ time: c.time, value: c.cvd })) },
  ] : []), [ok, data]);
  const read = useMemo(() => (ok ? cvdRead(data.candles) : null), [ok, data]);
  const u = coin(symbol);
  return (
    <Panel id="liq-cvd" title={`Cumulative volume delta (CVD) - ${u}`} right={(
      <div role="group" aria-label="CVD range" className="inline-flex gap-1">
        {CVD_RANGES.map((r) => (
          <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)} className={`focus-ring min-h-[44px] min-w-[44px] rounded-md px-2 text-xs font-medium ${range === r.id ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>{r.label}</button>
        ))}
      </div>
    )}>
      <p className="mb-2 text-xs text-slate-400">Taker buy volume minus taker sell volume from Binance USD-M futures candles. It resets to 0 at the start of the window, so only its direction and slope mean anything. Description of past trades, not advice.</p>
      {ok && error && <StaleNote at={data.generatedAt} />}
      {data && data.available === false ? (
        <Notice>CVD is unavailable from this source: {data.reason || 'taker volume is only reported by Binance futures.'}</Notice>
      ) : !ok ? (
        loading ? <LoadingBlock height={220} /> : <Notice tone={error ? 'error' : 'muted'}>{is404(error) ? 'No perpetual market for this symbol.' : error ? 'CVD unavailable for this symbol right now.' : 'No candles to show.'}</Notice>
      ) : (
        <>
          <StatChart series={series} height={220} label={`${u} cumulative volume delta over ${range} with candle close`} />
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400"><span><span className="text-cyan-300">Cyan</span> CVD (right axis, {u})</span><span><span className="text-slate-400">Grey</span> candle close (left axis)</span><span>{data.interval} candles</span></div>
          {read && (
            <p className="mt-2 text-xs leading-relaxed text-slate-300" role="status">
              Over the last {range}: <strong>{read.label}</strong> (net {read.net >= 0 ? '+' : ''}{compact(read.net)} {u}, {fmtPct(read.share)} of traded volume); the latest quarter of the window reads {read.recentLabel}. Price moved {fmtPct(read.priceChange)} to {fmtPrice(data.candles[data.candles.length - 1].close)}.
            </p>
          )}
          <p className="mt-1 text-[11px] text-slate-500">Source: Binance USD-M futures taker volume, 30 s cache; the last candle is still forming.</p>
        </>
      )}
    </Panel>
  );
};

export default Cvd;
