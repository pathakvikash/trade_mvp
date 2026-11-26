import React, { useCallback, useMemo, useState } from 'react';
import usePersistedState from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import { LoadingBlock } from '../ui/Skeleton';
import StatPopover from './StatPopover';
import CvdChart from './CvdChart';
import CvdSide from './CvdSide';
import { Notice, Panel, StaleNote, FUT, coin, fmtMarketPrice, fmtPct, is404 } from './shared';
import { CVD_INTERVALS, TRADE_THRESHOLDS, buildLines, cvdRead, cvdStats, detectDivergences, rebased, sliceView } from './cvdCalc';

const LOOKBACK = 20; // candles a "new high/low" is measured against
const compact = (n) => (n == null ? '--' : `${n >= 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n)}`);
const when = (sec) => new Date(sec * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const oneOf = (list) => (v) => list.includes(v);

const SHOW = [['vs', 'Futures vs spot'], ['combined', 'Combined'], ['fut', 'Futures'], ['spot', 'Spot']];
const SCALE = [['norm', 'Normalized'], ['abs', 'Absolute']];
const ANCHOR = [['view', 'Start of view'], ['window', 'Window start']];
const PANES = [['delta', 'Delta bars'], ['ratio', 'Buy/sell ratio'], ['volume', 'Volume']];
const MARKERS = [['div', 'Divergence'], ['tip', 'Tooltip']];

const btn = (on) => `focus-ring min-h-[44px] min-w-[44px] shrink-0 whitespace-nowrap rounded-md px-2 text-xs font-medium ${on ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`;
const Group = ({ label, children }) => (
  <div role="group" aria-label={label} className="flex shrink-0 items-center gap-1">
    <span className="text-[11px] uppercase tracking-wider text-slate-500">{label}</span>{children}
  </div>
);
const Seg = ({ label, items, value, onChange }) => (
  <Group label={label}>{items.map(([id, name]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={btn(value === id)}>{name}</button>)}</Group>
);
const Toggles = ({ label, items, value, onChange }) => (
  <Group label={label}>{items.map(([id, name]) => <button key={id} type="button" aria-pressed={!!value[id]} onClick={() => onChange({ ...value, [id]: !value[id] })} className={btn(value[id])}>{name}</button>)}</Group>
);

const Card = ({ label, value, sub, tone, children }) => (
  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
    <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`truncate text-sm font-semibold tabular-nums ${tone || 'text-slate-100'}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    {children}
  </div>
);
const sign = (n) => (n > 0 ? 'text-emerald-400' : n < 0 ? 'text-rose-400' : 'text-slate-100');

export const FAQ = [
  ['What is CVD?', 'Cumulative volume delta adds up, candle by candle, taker buy volume minus taker sell volume. A taker is the side that crossed the spread. It resets to 0 at the anchor, so only direction and slope mean anything.'],
  ['Where does the data come from?', 'Binance USD-M futures candles for futures, Binance spot candles for spot (both report taker buy volume). If a source cannot be reached the page says "unavailable from this source" and shows nothing for it. Nothing is estimated.'],
  ['What is a divergence?', `Price makes a new high (or low) over the previous ${LOOKBACK} candles while CVD does not make a new high (low) over those same candles. It is computed in your browser from the loaded candles with that one rule. It describes the past and is not a forecast.`],
  ['Normalized or absolute?', 'Normalized divides each line by its own largest absolute value in view so futures and spot, which trade in different sizes, can be compared by shape. Absolute shows base-coin units on one axis.'],
];

const Cvd = ({ symbol }) => {
  const [interval, setInterval_] = usePersistedState('liquidation.cvdInterval', '15m', { validate: oneOf(CVD_INTERVALS.map((i) => i.id)) });
  const [show, setShow] = usePersistedState('liquidation.cvdShow', 'vs', { validate: oneOf(SHOW.map((s) => s[0])) });
  const [scale, setScale] = usePersistedState('liquidation.cvdScale', 'norm', { validate: oneOf(SCALE.map((s) => s[0])) });
  const [anchor, setAnchor] = usePersistedState('liquidation.cvdAnchor', 'view', { validate: oneOf(ANCHOR.map((s) => s[0])) });
  const [marks, setMarks] = usePersistedState('liquidation.cvdMarkers', { div: true, tip: true }, { validate: (v) => v && typeof v === 'object' });
  const [panes, setPanes] = usePersistedState('liquidation.cvdPanes', { delta: true, ratio: false, volume: false }, { validate: (v) => v && typeof v === 'object' });
  const [tab, setTab] = usePersistedState('liquidation.cvdTab', 'trades', { validate: oneOf(['trades', 'div']) });
  const [min, setMin] = usePersistedState('liquidation.cvdMin', 100e3, { validate: oneOf(TRADE_THRESHOLDS) });
  const [view, setView] = useState(null); // visible time range reported by the chart; null = everything loaded
  const [resetKey, setResetKey] = useState(0);

  const { data, error, loading } = usePolling(`${FUT}/cvd/${symbol}?interval=${interval}`, 30000);
  const fut = data?.available ? data.candles : null;
  const spot = data?.spot?.available ? data.spot.candles : null;
  const grid = fut || spot;
  const ready = !!data && data.symbol === symbol && !!grid && grid.length > 0;

  const onRange = useCallback((r) => setView((v) => (v && v.from === r.from && v.to === r.to ? v : r)), []);
  const reset = () => { setView(null); setResetKey((k) => k + 1); };
  const pick = (i) => { setInterval_(i); setView(null); };

  const stats = useMemo(() => (ready ? cvdStats(fut, spot, view, LOOKBACK) : null), [ready, fut, spot, view]);
  const lines = useMemo(() => (ready ? buildLines(fut, spot, { show, scale, view, anchor, grid: grid.map((c) => c.time) }) : []), [ready, fut, spot, show, scale, view, anchor, grid]);
  const divs = useMemo(() => (grid ? detectDivergences(grid, LOOKBACK) : []), [grid]);
  const markers = marks.div ? divs : [];
  const read = useMemo(() => {
    const c = fut && sliceView(fut, view);
    return c && c.length > 1 ? cvdRead(rebased(c)) : null;
  }, [fut, view]);
  const u = coin(symbol);
  const status = loading && !data ? 'Loading' : error && data ? 'Stale' : 'Live';
  const lead = stats?.lead;

  return (
    <Panel id="liq-cvd" title="Cumulative volume delta (CVD)" right={(
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs font-medium text-slate-200">{u}</span>
        <span role="status" data-testid="cvd-status" className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status === 'Live' ? 'bg-emerald-400/10 text-emerald-300' : status === 'Stale' ? 'bg-amber-400/10 text-amber-300' : 'bg-slate-800 text-slate-300'}`}>{status}</span>
        <StatPopover label="About CVD" trigger="FAQ" className="focus-ring min-h-[44px] min-w-[44px] rounded-md px-2 text-xs text-slate-400 hover:text-slate-200">
          <div className="space-y-2">{FAQ.map(([q, a]) => <p key={q}><strong className="text-slate-100">{q}</strong> {a}</p>)}</div>
        </StatPopover>
      </div>
    )}>
      <div role="group" aria-label="CVD interval" className="mb-2 flex gap-1 overflow-x-auto">
        {CVD_INTERVALS.map((i) => <button key={i.id} type="button" aria-pressed={interval === i.id} onClick={() => pick(i.id)} className={btn(interval === i.id)}>{i.label}</button>)}
      </div>
      <p className="mb-2 text-xs text-slate-400">Taker buy volume minus taker sell volume from Binance futures and spot candles. It restarts at 0 at the anchor, so only direction and slope mean anything. Description of past trades, not advice.</p>
      {ready && error && <StaleNote at={data.generatedAt} />}
      {data && !grid ? (
        <Notice>CVD is unavailable from this source: {data.reason || 'taker volume is only reported by Binance.'}</Notice>
      ) : !ready ? (
        loading ? <LoadingBlock height={260} /> : <Notice tone={error ? 'error' : 'muted'}>{is404(error) ? 'No perpetual market for this symbol.' : error ? 'CVD unavailable for this symbol right now.' : 'No candles to show.'}</Notice>
      ) : (
        <>
          <div data-testid="cvd-cards" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Card label="Last price" value={stats.price ? fmtMarketPrice(stats.price.last) : '--'} sub={stats.price ? `${fmtPct(stats.price.changePct)} in view` : null} tone={sign(stats.price?.changePct)} />
            <Card label="Futures CVD (in view)" value={stats.fut ? `${compact(stats.fut.net)} ${u}` : 'unavailable'} sub={stats.fut ? null : 'unavailable from this source'} tone={sign(stats.fut?.net)} />
            <Card label="Spot CVD (in view)" value={stats.spot ? `${compact(stats.spot.net)} ${u}` : 'unavailable'} sub={stats.spot ? null : 'unavailable from this source'} tone={sign(stats.spot?.net)} />
            <Card label="Taker buy % (in view)" value={stats.takerBuyPct == null ? '--' : `${stats.takerBuyPct.toFixed(1)}%`}>
              {stats.takerBuyPct != null && (
                <div role="img" aria-label={`Taker buys ${stats.takerBuyPct.toFixed(1)} percent, sells ${(100 - stats.takerBuyPct).toFixed(1)} percent`} className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="bg-emerald-500" style={{ width: `${stats.takerBuyPct}%` }} /><div className="bg-rose-500" style={{ width: `${100 - stats.takerBuyPct}%` }} />
                </div>
              )}
            </Card>
            <Card label="Spot vs futures" value={lead ? lead.tag : '--'} sub={lead?.text} />
            <Card label="Latest divergence" value={stats.divergence ? (stats.divergence.type === 'bullish' ? 'Bullish' : 'Bearish') : 'None'} sub={stats.divergence ? `${when(stats.divergence.time)} at ${fmtMarketPrice(stats.divergence.price)}` : `none in the last ${grid.length} candles`} tone={stats.divergence ? (stats.divergence.type === 'bullish' ? 'text-emerald-400' : 'text-rose-400') : undefined} />
          </div>
          <div data-testid="cvd-controls" className="mb-2 flex items-center gap-x-4 gap-y-1 overflow-x-auto sm:flex-wrap">
            <Seg label="Show" items={SHOW} value={show} onChange={setShow} />
            <Seg label="Anchor" items={ANCHOR} value={anchor} onChange={setAnchor} />
            <Seg label="Scale" items={SCALE} value={scale} onChange={setScale} />
            <Toggles label="Markers" items={MARKERS} value={marks} onChange={setMarks} />
            <Toggles label="Panes" items={PANES} value={panes} onChange={setPanes} />
            <button type="button" onClick={reset} className={btn(false)}>Reset view</button>
          </div>
          {data.spot && !spot && show !== 'fut' && <p className="mb-1 text-xs text-amber-400">Spot CVD is unavailable from this source: {data.spot.reason}</p>}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              {lines.length === 0 ? <Notice>The {show === 'spot' ? 'spot' : show === 'combined' ? 'combined' : 'futures'} series is unavailable from this source.</Notice> : null}
              <CvdChart grid={grid} lines={lines} panes={panes} markers={markers} tooltip={!!marks.tip} resetKey={resetKey} onRange={onRange} normalized={scale === 'norm'} label={`${u} price, cumulative volume delta and delta bars, ${interval} candles`} />
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                {lines.map((l) => <span key={l.id}><span style={{ color: l.color }}>{l.label}</span> CVD</span>)}
                <span>{scale === 'norm' ? 'lines scaled to their own peak in view' : `base units (${u})`}</span><span>{interval} candles</span>
              </div>
              {read && (
                <p className="mt-2 text-xs leading-relaxed text-slate-300" role="status">
                  Over the view: <strong>{read.label}</strong> in futures (net {compact(read.net)} {u}, {fmtPct(read.share)} of traded volume); the latest quarter reads {read.recentLabel}. Price moved {fmtPct(read.priceChange)}.
                </p>
              )}
            </div>
            <CvdSide symbol={symbol} tab={tab} onTab={setTab} min={min} onMin={setMin} divergences={divs} lookback={LOOKBACK} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Source: Binance USD-M futures and spot taker volume, 30 s cache; the last candle is still forming. Drag to pan, Ctrl+scroll or pinch to zoom, double-click to fit.</p>
        </>
      )}
    </Panel>
  );
};

export default Cvd;
