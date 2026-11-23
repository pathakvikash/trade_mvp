import React, { useMemo } from 'react';
import usePersistedState from '../lib/usePersistedState';
import usePolling from '../lib/usePolling';
import MarketTable from '../components/derivatives/MarketTable';
import RealMarkets from '../components/derivatives/RealMarkets';
import FundingStrip from '../components/derivatives/FundingStrip';
import StatChart from '../components/derivatives/StatChart';
import { readouts } from '../components/derivatives/signals';
import AgentLauncher from '../components/ai/AgentLauncher';
import SegTabs from '../components/ui/SegTabs';
import { LoadingBlock } from '../components/ui/Skeleton';
import { Updating } from '../components/ui/Spinner';
import SymbolCombobox, { buildSymbols } from '../components/trade/SymbolCombobox';
import { sourceNote } from '../components/ui/sourceNote';
import { FUT, Notice, Panel, coin, is404 } from '../components/liquidation/shared';
import MaximizeButton, { MaximizeBackdrop } from '../components/ui/MaximizeButton';
import useMaximize from '../components/ui/useMaximize';

const PERIODS = ['5m', '15m', '1h', '4h'].map((id) => ({ id, label: id }));
const EMERALD = '#34d399';
const ROSE = '#fb7185';
const CYAN = '#22d3ee';
const AMBER = '#fbbf24';

// ms timestamps -> chart points, dropping duplicate/out-of-order times
const toPts = (arr, val, ms = true) => {
  let prev = 0;
  return (arr || []).reduce((out, p) => {
    const time = Math.floor(ms ? p.ts / 1000 : p.time);
    const value = val(p);
    if (time > prev && Number.isFinite(value)) { out.push({ time, value }); prev = time; }
    return out;
  }, []);
};

const ChartCard = ({ title, series, note, label }) => {
  const mx = useMaximize();
  return (
    <>
      <MaximizeBackdrop max={mx.max} onClose={mx.exit} />
      <Panel
        title={title}
        className={mx.panelClass}
        {...mx.panelProps}
        right={<div className="flex items-center gap-2">{note && <span className="text-xs tabular-nums text-slate-400">{note}</span>}<MaximizeButton max={mx.max} onToggle={mx.toggle} /></div>}
      >
        {series.some((s) => s.data.length) ? <StatChart series={series} label={label || title} fill={mx.max} /> : <Notice>No data for this period.</Notice>}
      </Panel>
    </>
  );
};

const lastOf = (a, f) => (a && a.length ? f(a[a.length - 1]) : null);

const ChartsSkeleton = () => (
  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-busy="true">
    {[0, 1, 2, 3, 4].map((i) => <Panel key={i}><LoadingBlock height={180} /></Panel>)}
  </div>
);

const Derivatives = () => {
  const [symbol, setSymbol] = usePersistedState('derivatives.symbol', 'BTCUSDT', { validate: (v) => /^[A-Z0-9]{2,20}USDT$/.test(v) });
  const [period, setPeriod] = usePersistedState('derivatives.period', '1h', { validate: (v) => PERIODS.some((p) => p.id === v) });
  const ov = usePolling(`${FUT}/overview`, 15000);
  const st = usePolling(`${FUT}/stats/${symbol}?period=${period}`, 60000);
  const kl = usePolling(`${FUT}/klines/${symbol}?interval=${period}&limit=200`, 60000);
  const rows = Array.isArray(ov.data) ? ov.data : null;
  const allSyms = usePolling(`${FUT}/symbols`, 300000); // every perp, not just the top-40 overview
  const symbols = useMemo(() => buildSymbols(allSyms.data, rows || [], [], coin(symbol)), [allSyms.data, rows, symbol]);
  const s = st.data;

  const c = useMemo(() => {
    const price = toPts(kl.data, (k) => k.close, false);
    const line = (arr, f, color) => [{ kind: 'line', color, data: toPts(arr, f) }];
    return {
      price,
      oi: [{ kind: 'line', color: CYAN, data: toPts(s?.openInterest, (p) => p.oiUsd) }, { kind: 'line', color: '#94a3b8', scale: 'left', data: price }],
      ls: line(s?.longShort, (p) => p.ratio, EMERALD),
      top: line(s?.topLongShort, (p) => p.ratio, AMBER),
      taker: line(s?.takerBuySell, (p) => p.ratio, CYAN),
      funding: [{ kind: 'histogram', color: EMERALD, data: toPts(s?.funding, (p) => p.rate * 100).map((p) => ({ ...p, color: p.value >= 0 ? EMERALD : ROSE })) }],
    };
  }, [s, kl.data]);

  const signals = useMemo(() => readouts(s, Array.isArray(kl.data) ? kl.data.map((k) => k.close) : null), [s, kl.data]);
  const ratio = (a) => { const v = lastOf(a, (p) => p.ratio); return v === null ? null : v.toFixed(2); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-200">Derivatives</h1>
          <p className="text-xs text-slate-400">Binance USD-M perpetuals: funding, open interest and positioning.</p>
        </div>
        <AgentLauncher kind="perp" symbol={symbol} page="derivatives" interval={period} />
      </div>
      <MarketTable rows={rows} error={ov.error} source={ov.source} selected={symbol} onSelect={setSymbol} />
      <FundingStrip rows={rows} error={ov.error} selected={symbol} onSelect={setSymbol} />
      <RealMarkets />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">{coin(symbol)} positioning <Updating show={!!st.fetching} /></h2>
        <div className="flex items-center gap-2">
          <div className="w-40"><SymbolCombobox symbols={symbols} overview={rows || []} value={coin(symbol)} onSelect={(b) => setSymbol(`${b}USDT`)} /></div>
          <SegTabs label="Period" tabs={PERIODS} active={period} onChange={setPeriod} />
        </div>
      </div>
      {[...new Set([sourceNote(kl.source, 'priceLine'), sourceNote(st.source || s?.source, 'positioning'), s?.degraded && sourceNote('unavailable', 'positioning')].filter(Boolean))].map((t) => <Notice key={t}>{t}</Notice>)}
      {st.error && !s && <Notice tone="error">{is404(st.error) ? `No perpetual market for ${coin(symbol)}.` : `Stats unavailable for ${coin(symbol)} right now.`}</Notice>}
      {!s && st.loading && <ChartsSkeleton />}
      {s && (
        <div className={`space-y-3 transition-opacity ${st.fetching ? 'opacity-60' : ''}`}>
          <Panel title="Read-outs" right={<span className="text-[11px] text-slate-500">Rule-based signal, not advice</span>}>
            {signals.length ? <ul className="space-y-1 text-sm text-slate-200">{signals.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="text-sm text-slate-400">Not enough data for a read-out.</p>}
          </Panel>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title="Open interest (USD, cyan) with price (grey, left axis)" series={c.oi} note={lastOf(s.openInterest, (p) => `$${(p.oiUsd / 1e9).toFixed(2)}B`)} />
            <ChartCard title="Long/short account ratio" series={c.ls} note={ratio(s.longShort)} />
            <ChartCard title="Top-trader long/short ratio" series={c.top} note={ratio(s.topLongShort)} />
            <ChartCard title="Taker buy/sell ratio" series={c.taker} note={ratio(s.takerBuySell)} />
            <ChartCard title="Funding rate history (%)" series={c.funding} note={lastOf(s.funding, (p) => `${(p.rate * 100).toFixed(4)}%`)} />
          </div>
        </div>
      )}
    </div>
  );
};

export default Derivatives;
