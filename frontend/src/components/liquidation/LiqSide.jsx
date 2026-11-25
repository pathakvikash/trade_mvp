import React, { useMemo } from 'react';
import usePolling from '../../lib/usePolling';
import { FUT, Panel, fmtPct, fmtPrice, fmtUsd } from './shared';
import Skeleton from '../ui/Skeleton';
import StatPopover from './StatPopover';

const share = (a, b) => (a + b > 0 ? Math.round((a / (a + b)) * 100) : 0);

// One side of the ladder: a row per key level with a bar scaled to the largest level; hover/focus highlights its band.
const Rows = ({ rows, max, color, side, price, onHighlight }) => rows.map((l) => (
  <li key={l.price}>
    <StatPopover
      label={`${side === 'short' ? 'Short' : 'Long'} liquidation level ${fmtPrice(l.price)}`}
      tip={`${fmtUsd(l.usd)} of estimated ${side} liquidations at ${fmtPrice(l.price)}. Click for details`}
      onMouseEnter={() => onHighlight(l.price)}
      onMouseLeave={() => onHighlight(null)}
      onFocus={() => onHighlight(l.price)}
      onBlur={() => onHighlight(null)}
      className="focus-ring relative block w-full overflow-hidden rounded px-2 py-1 text-left text-xs tabular-nums hover:bg-slate-800/60"
      trigger={(
        <>
          <span aria-hidden="true" className={`absolute inset-y-0 left-0 opacity-25 ${color}`} style={{ width: `${Math.max(2, (l.usd / max) * 100)}%` }} />
          <span className="relative flex justify-between gap-2">
            <span className="text-slate-200">{fmtPrice(l.price)}</span>
            <span className="text-slate-200">{fmtUsd(l.usd)}</span>
            <span className="w-14 text-right text-slate-400">{fmtPct(l.pct)}</span>
          </span>
        </>
      )}
    >
      <dl className="space-y-1 tabular-nums">
        <div className="flex justify-between"><dt>Price</dt><dd className="text-slate-100">{fmtPrice(l.price)}</dd></div>
        <div className="flex justify-between"><dt>Estimated size</dt><dd className="text-slate-100">{fmtUsd(l.usd)}</dd></div>
        <div className="flex justify-between"><dt>Side</dt><dd className={side === 'short' ? 'text-rose-400' : 'text-emerald-400'}>{side === 'short' ? 'Short liquidations (above price)' : 'Long liquidations (below price)'}</dd></div>
        <div className="flex justify-between"><dt>From price {fmtPrice(price)}</dt><dd className="text-slate-100">{fmtPct(l.pct)}</dd></div>
      </dl>
      <p className="mt-1.5 text-[11px] text-slate-400">Model estimate, not exchange data.</p>
    </StatPopover>
  </li>
));

export const KeyLevels = ({ data, onHighlight }) => {
  const k = data.keyLevels;
  const max = Math.max(1, ...k.above.map((l) => l.usd), ...k.below.map((l) => l.usd));
  return (
    <Panel id="liq-levels" title="Key liquidation levels">
      <h3 className="px-2 text-[11px] text-rose-400">Above · short liquidations</h3>
      <ul className="mb-1">{k.above.length ? <Rows rows={[...k.above].reverse()} max={max} color="bg-rose-400" side="short" price={data.price} onHighlight={onHighlight} /> : <li className="px-2 py-1 text-xs text-slate-500">None estimated.</li>}</ul>
      <div className="my-1 border-y border-slate-800 px-2 py-1 text-center text-xs tabular-nums text-slate-200">Price {fmtPrice(data.price)}</div>
      <h3 className="px-2 text-[11px] text-emerald-400">Below · long liquidations</h3>
      <ul><Rows rows={k.below} max={max} color="bg-emerald-400" side="long" price={data.price} onHighlight={onHighlight} />{!k.below.length && <li className="px-2 py-1 text-xs text-slate-500">None estimated.</li>}</ul>
    </Panel>
  );
};

export const Overview = ({ data, symbol }) => {
  const { data: liq, error } = usePolling(`${FUT}/liquidations/${symbol}`, 30000);
  const sampled = useMemo(() => {
    const cut = Date.now() - 24 * 3600e3;
    const t = { long: 0, short: 0 };
    (liq?.events || []).forEach((e) => { if (e.ts >= cut) t[e.side] += e.usd; });
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liq]);
  const { longUsd, shortUsd } = data.totals;
  const outside = data.outOfViewUsd || 0;
  const lp = share(longUsd, shortUsd);
  const big = data.largest;
  return (
    <Panel title="Market overview">
      <dl className="space-y-2 text-xs tabular-nums">
        <div className="flex justify-between"><dt className="text-slate-400">Open estimated levels (all)</dt><dd className="text-slate-200">{fmtUsd(longUsd + shortUsd)}</dd></div>
        <div>
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`Longs below price ${lp} percent, shorts above price ${100 - lp} percent`}>
            {longUsd + shortUsd > 0 && <><div className="bg-emerald-400" style={{ width: `${lp}%` }} /><div className="bg-rose-400" style={{ width: `${100 - lp}%` }} /></>}
          </div>
          <div className="mt-1 flex justify-between"><span className="text-emerald-400">Longs below {fmtUsd(longUsd)} ({lp}%)</span><span className="text-rose-400">Shorts above {fmtUsd(shortUsd)} ({100 - lp}%)</span></div>
        </div>
        <div className="flex justify-between"><dt className="text-slate-400">Outside visible range</dt><dd className="text-slate-200">{fmtUsd(outside)}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-400">Largest single level</dt><dd className="text-slate-200">{big ? `${fmtUsd(big.usd)} ${big.side}s at ${fmtPrice(big.price)} (${fmtPct(((big.price / data.price) - 1) * 100)})` : '--'}</dd></div>
        <div className="flex justify-between"><dt className="text-slate-400">Price step / column</dt><dd className="text-slate-200">{fmtPrice(data.priceStep)} / {Math.round(data.colMs / 60000)}m</dd></div>
        <div className="border-t border-slate-800 pt-2">
          <dt className="text-slate-400">Liquidated 24h (sampled)</dt>
          <dd className="mt-0.5 flex justify-between">
            {!liq && !error ? <><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-20" /></> : error && !liq ? <span className="text-slate-500">unavailable</span> : <><span className="text-emerald-400">Longs {fmtUsd(sampled.long)}</span><span className="text-rose-400">Shorts {fmtUsd(sampled.short)}</span></>}
          </dd>
          <p className="mt-0.5 text-[11px] text-slate-500">Realized, sampled by the exchange feed: real totals are higher.</p>
        </div>
      </dl>
    </Panel>
  );
};

