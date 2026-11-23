import React, { useMemo } from 'react';
import Panel from '../ui/Panel';
import Skeleton from '../ui/Skeleton';
import usePolling from '../../lib/usePolling';
import { FUT, Notice, coin } from '../liquidation/shared';
import { fmtMarketPrice, fmtTime, fmtUsd } from '../ui/fmt';

const LIMIT = 40;

// Most recent sampled liquidations for one futures symbol (e.g. BTCUSDT), newest first, polled every 15s.
// The feed is sampled server-side, so this is not a full liquidation history.
const SymbolLiquidations = ({ symbol, className = '' }) => {
  const { data, error } = usePolling(symbol ? `${FUT}/liquidations/${symbol}` : null, 15000);
  const rows = useMemo(() => [...(data?.events || [])].sort((a, b) => b.ts - a.ts).slice(0, LIMIT), [data]);
  const name = coin(symbol);

  let body;
  if (!data && error) {
    body = <Notice tone="error">Liquidation feed unavailable, retrying.</Notice>;
  } else if (!data) {
    body = (
      <div className="space-y-2 px-3 pt-2" aria-busy="true" aria-label="Loading liquidations">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-3 w-full" />)}
      </div>
    );
  } else if (rows.length === 0) {
    body = <Notice>No liquidations sampled yet for {name}.</Notice>;
  } else {
    body = (
      <div className="absolute inset-0 overflow-auto overscroll-contain">
        <table className="w-full text-[11px] tabular-nums">
          <caption className="sr-only">Most recent sampled liquidations for {name}</caption>
          <thead className="sticky top-0 bg-slate-950 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="px-2 py-1.5 font-medium">Time</th>
              <th scope="col" className="px-2 py-1.5 font-medium">Side</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">Price</th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">USD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={`${e.ts}-${e.price}-${e.qty}-${i}`} className="border-t border-slate-800/60">
                <td className="px-2 py-1 text-slate-400">{fmtTime(e.ts)}</td>
                <td className={`px-2 py-1 ${e.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>{e.side === 'long' ? 'Long' : 'Short'}</td>
                <td className="px-2 py-1 text-right text-slate-300">{fmtMarketPrice(e.price)}</td>
                <td className="px-2 py-1 text-right text-slate-200">{fmtUsd(e.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Panel
      title={`Liquidations · ${name}`}
      right={<span className="text-[10px] uppercase tracking-wider text-slate-500">sampled</span>}
      className={`min-h-0 ${className}`}
      bodyClassName="relative min-h-0 p-0"
    >
      {body}
    </Panel>
  );
};

export default SymbolLiquidations;
