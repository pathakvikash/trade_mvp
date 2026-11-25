import React, { useMemo } from 'react';
import { Notice, Panel, SortTh, coin, fmtUsd, useSort } from './shared';
import { squarify } from './treemap';
import { LoadingBlock } from '../ui/Skeleton';
import { Tip } from '../ui/Tooltip';
import StatPopover from './StatPopover';

const W = 100;
const H = 56;
const TOP = 40;

const getters = {
  symbol: (r) => r.symbol,
  total: (r) => r.total,
  long: (r) => r.longUsd,
  short: (r) => r.shortUsd,
  count: (r) => r.count,
};

// onHeatmap (optional): switch the page's heatmap to a coin without opening the drawer (the popover's "Open heatmap").
const CoinInfo = ({ item, grand, dominant, onHeatmap }) => {
  const lp = Math.round((item.longUsd / item.total) * 100);
  return (
    <div className="space-y-1.5 tabular-nums">
      <p className="font-medium text-slate-100">{coin(item.symbol)}: {fmtUsd(item.total)} liquidated, 24h (sampled)</p>
      <p><span className="text-emerald-400">Longs {fmtUsd(item.longUsd)} ({lp}%)</span> · <span className="text-rose-400">Shorts {fmtUsd(item.shortUsd)} ({100 - lp}%)</span></p>
      <p>{grand ? ((item.total / grand) * 100).toFixed(1) : 0}% of all sampled liquidations, mostly {dominant}s, {item.count} events.</p>
      <p className="text-[11px] text-slate-400">Sampled: real totals are higher.</p>
      {onHeatmap && <button type="button" onClick={() => { onHeatmap(item.symbol); document.getElementById('liq-heatmap')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }} className="focus-ring rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">Open heatmap</button>}
    </div>
  );
};

const CoinTreemap = ({ bySymbol, error, selected, onSelect, onHeatmap }) => {
  const rows = useMemo(
    () => (bySymbol || []).map((r) => ({ ...r, total: r.longUsd + r.shortUsd, value: r.longUsd + r.shortUsd })),
    [bySymbol],
  );
  const cells = useMemo(() => squarify([...rows].sort((a, b) => b.value - a.value).slice(0, TOP), W, H), [rows]);
  const grand = useMemo(() => rows.reduce((t, r) => t + r.total, 0), [rows]);
  const { sorted, sort, toggle } = useSort(rows, getters, 'total', 'desc', 'liquidation.treemap');

  return (
    <Panel title="Liquidations by coin, 24h (sampled)">
      {!bySymbol && error ? <Notice tone="error">Liquidation feed unavailable, retrying.</Notice> : !bySymbol ? <LoadingBlock height={220} /> : rows.length === 0 ? <Notice>No liquidations sampled yet.</Notice> : (
        <>
          <div className="relative h-[220px] w-full md:h-[300px]">
            {cells.map(({ item, x, y, w, h }) => {
              const lp = item.longUsd / item.total;
              const dominant = lp >= 0.5 ? 'long' : 'short';
              const strength = Math.abs(lp - 0.5) * 2; // 0 even .. 1 one-sided
              const rgb = dominant === 'long' ? '52, 211, 153' : '251, 113, 133';
              return (
                <div
                  key={item.symbol}
                  className={`absolute hover:z-10 ${item.symbol === selected ? 'z-10' : ''}`}
                  style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%` }}
                >
                  <Tip text={`${coin(item.symbol)} ${fmtUsd(item.total)} (long ${fmtUsd(item.longUsd)} / short ${fmtUsd(item.shortUsd)})`} describe={false}>
                    <button
                      type="button"
                      onClick={() => onSelect(item.symbol)}
                      aria-pressed={item.symbol === selected}
                      aria-label={`${coin(item.symbol)}: ${fmtUsd(item.total)} liquidated, ${(lp * 100).toFixed(0)} percent longs`}
                      className={`focus-ring absolute inset-0 overflow-hidden border border-slate-950 p-1 text-left text-xs leading-tight text-slate-100 transition hover:brightness-125 hover:ring-1 hover:ring-inset hover:ring-slate-200/60 ${item.symbol === selected ? 'ring-2 ring-inset ring-cyan-300 brightness-110' : ''}`}
                      style={{ backgroundColor: `rgba(${rgb}, ${0.2 + 0.45 * strength})` }}
                    >
                      {w * h > 60 && (
                        <>
                          <span className="block font-semibold">{coin(item.symbol)}</span>
                          <span className="block tabular-nums text-slate-200/80">{fmtUsd(item.total)}</span>
                        </>
                      )}
                    </button>
                  </Tip>
                  {w * h > 60 && (
                    <StatPopover
                      label={`${coin(item.symbol)} details`}
                      tip="Details"
                      className="focus-ring absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/60 text-[11px] font-semibold text-slate-200 hover:bg-slate-950"
                      trigger={<span aria-hidden="true">i</span>}
                    >
                      <CoinInfo item={item} grand={grand} dominant={dominant} onHeatmap={onHeatmap} />
                    </StatPopover>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Cell size = total USD; green = mostly longs liquidated, red = mostly shorts. Top {TOP} shown. Click a coin or row for details; the i button on a large tile shows its split.</p>
          <div className="mt-3 max-h-64 overflow-auto overscroll-contain">
            <table className="w-full text-xs tabular-nums">
              <caption className="sr-only">Sampled 24h liquidations by coin</caption>
              <thead className="sticky top-0 bg-slate-950 text-[11px] text-slate-500">
                <tr>
                  <SortTh k="symbol" sort={sort} toggle={toggle} left>Coin</SortTh>
                  <SortTh k="total" sort={sort} toggle={toggle}>Total</SortTh>
                  <SortTh k="long" sort={sort} toggle={toggle}>Longs</SortTh>
                  <SortTh k="short" sort={sort} toggle={toggle}>Shorts</SortTh>
                  <SortTh k="count" sort={sort} toggle={toggle}>Events</SortTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.symbol}
                    tabIndex={0}
                    aria-selected={r.symbol === selected}
                    onClick={() => onSelect(r.symbol)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.symbol); } }}
                    className={`cursor-pointer border-t border-slate-800/60 hover:bg-slate-900 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${r.symbol === selected ? 'bg-cyan-400/10' : ''}`}>
                    <td className="px-2 py-1 font-medium text-slate-200">{coin(r.symbol)}</td>
                    <td className="px-2 py-1 text-right">{fmtUsd(r.total)}</td>
                    <td className="px-2 py-1 text-right text-emerald-400">{fmtUsd(r.longUsd)}</td>
                    <td className="px-2 py-1 text-right text-rose-400">{fmtUsd(r.shortUsd)}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
};

export default CoinTreemap;
