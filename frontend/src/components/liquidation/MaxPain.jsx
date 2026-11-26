import React from 'react';
import { LoadingBlock } from '../ui/Skeleton';
import { PARTIAL_NOTE, sourceNote, Notice, Panel, StaleNote, coin, fmtPct, fmtPrice, fmtUsd, is404 } from './shared';
import { maxPain } from './maxPainCalc';

// One ladder row: bar scaled to the biggest listed level; the max-pain row carries a marker.
const Row = ({ l, max, side, pain }) => (
  <li className={`relative overflow-hidden rounded px-2 py-1.5 text-xs tabular-nums ${pain ? 'ring-1 ring-amber-400/70' : ''}`}>
    <span aria-hidden="true" className={`absolute inset-y-0 left-0 opacity-25 ${side === 'short' ? 'bg-rose-400' : 'bg-emerald-400'}`} style={{ width: `${Math.max(2, (l.usd / max) * 100)}%` }} />
    <span className="relative flex items-center justify-between gap-2">
      <span className="text-slate-200">{fmtPrice(l.price)}{pain && <span className="ml-1.5 rounded bg-amber-400/20 px-1 text-[10px] uppercase text-amber-400">Max pain</span>}</span>
      <span className="text-slate-200">{fmtUsd(l.usd)}</span>
    </span>
  </li>
);

// Max pain panel, fed by the heatmap payload LiqHeat already polls (same range, same estimate).
const MaxPain = ({ symbol, range, data, source, loading, error }) => {
  const m = data && data.cols > 0 ? maxPain(data) : null;
  const same = (l) => m && l.price === m.price;
  // the max-pain bucket is always on the ladder, even when it is not among the 3 largest peaks of its side
  const rows = (list, side) => {
    const l = list.filter((x) => !same(x));
    if (m && m.side === side) l.push({ price: m.price, usd: m.usd });
    return l.sort((a, b) => b.price - a.price);
  };
  const above = m ? rows(m.above, 'short') : [];
  const below = m ? rows(m.below, 'long') : [];
  const max = m ? Math.max(1, ...above.map((l) => l.usd), ...below.map((l) => l.usd)) : 1;
  const lp = m && m.longUsd + m.shortUsd > 0 ? Math.round((m.longUsd / (m.longUsd + m.shortUsd)) * 100) : 0;
  return (
    <Panel id="liq-max-pain" title={`Liquidation max pain - ${coin(symbol)}`} right={<span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[11px] text-amber-400">Estimate</span>}>
      <p className="mb-2 text-xs text-amber-400">Estimate based on inferred positions, not exchange data. Not advice.</p>
      {sourceNote(source, 'heatmap') && <p className="mb-2 text-xs text-amber-400">{sourceNote(source, 'heatmap')}</p>}
      {m && error && <StaleNote at={data.generatedAt} />}
      {data?.partial && <p className="mb-2 text-xs text-amber-400">{PARTIAL_NOTE}</p>}
      {!m ? (
        loading ? <LoadingBlock height={160} /> : <Notice tone={error ? 'error' : 'muted'}>{is404(error) ? 'No perpetual market for this symbol.' : error ? 'Max pain unavailable for this symbol right now.' : 'No estimated liquidation levels to rank.'}</Notice>
      ) : (
        <>
          <dl className="mb-2 grid grid-cols-2 gap-2 text-xs tabular-nums">
            <div><dt className="text-slate-400">Max pain price</dt><dd className="text-base font-semibold text-amber-400">{fmtPrice(m.price)}</dd></div>
            <div><dt className="text-slate-400">From current {fmtPrice(data.price)}</dt><dd className="text-base font-semibold text-slate-200">{fmtPct(m.pct)}</dd></div>
          </dl>
          <p className="mb-2 text-xs text-slate-400">Largest estimated cluster: {fmtUsd(m.usd)} of {m.side} liquidations (range {range}).</p>
          <ul aria-label="Price ladder, top 3 clusters above and below the price" className="space-y-0.5">
            {above.map((l) => <Row key={l.price} l={l} max={max} side="short" pain={same(l)} />)}
            <li className="my-1 border-y border-slate-800 px-2 py-1.5 text-center text-xs tabular-nums text-cyan-300">Price {fmtPrice(data.price)}</li>
            {below.map((l) => <Row key={l.price} l={l} max={max} side="long" pain={same(l)} />)}
          </ul>
          <div className="mt-3 text-xs tabular-nums">
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`Estimated long liquidations ${lp} percent, short ${100 - lp} percent`}>
              <div className="bg-emerald-400" style={{ width: `${lp}%` }} /><div className="bg-rose-400" style={{ width: `${100 - lp}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap justify-between gap-x-3"><span className="text-emerald-400">Longs {fmtUsd(m.longUsd)}</span><span className="text-rose-400">Shorts {fmtUsd(m.shortUsd)}</span></div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Rows above the price are short liquidations, below are long. Built from the same open-interest model as the heatmap; real positions are not public.</p>
        </>
      )}
    </Panel>
  );
};

export default MaxPain;
