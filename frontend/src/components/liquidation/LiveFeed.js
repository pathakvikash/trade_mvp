import React, { useMemo } from 'react';
import { Notice, Panel, coin, fmtMarketPrice, fmtTime, fmtUsd } from './shared';
import Skeleton from '../ui/Skeleton';
import ScrollArea from '../ui/ScrollArea';

const BIG = 100000;

const LiveFeed = ({ recent, error }) => {
  const rows = useMemo(() => [...(recent || [])].sort((a, b) => b.ts - a.ts).slice(0, 60), [recent]);
  return (
    <Panel title="Live feed (all symbols)" right={<span className="text-[11px] text-amber-400">highlighted: $100K+</span>}>
      {rows.length === 0 && !recent && !error ? (
        <div className="space-y-2 py-1" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-3 w-full" />)}
        </div>
      ) : rows.length === 0 ? <Notice tone={error ? 'error' : 'muted'}>{error ? 'Feed unavailable, retrying.' : 'Waiting for liquidations...'}</Notice> : (
        <ScrollArea label="Live liquidation feed" footer={`Showing ${rows.length} most recent, scroll for more`}>
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Most recent sampled liquidations</caption>
            <thead className="sticky top-0 bg-slate-950 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr><th className="px-2 py-1 font-medium">Time</th><th className="px-2 py-1 font-medium">Coin</th><th className="px-2 py-1 font-medium">Side</th><th className="px-2 py-1 text-right font-medium">Price</th><th className="px-2 py-1 text-right font-medium">USD</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={`${e.symbol}${e.ts}${e.price}${e.qty}`} className={`border-t border-slate-800/60 ${e.usd >= BIG ? 'bg-amber-400/10 font-semibold' : ''}`}>
                  <td className="px-2 py-1 text-slate-400">{fmtTime(e.ts)}</td>
                  <td className="px-2 py-1 text-slate-200">{coin(e.symbol)}</td>
                  <td className={`px-2 py-1 ${e.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}>{e.side === 'long' ? 'Long liq' : 'Short liq'}</td>
                  <td className="px-2 py-1 text-right text-slate-300">{fmtMarketPrice(e.price)}</td>
                  <td className={`px-2 py-1 text-right ${e.usd >= BIG ? 'text-amber-400' : 'text-slate-200'}`}>{fmtUsd(e.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      )}
    </Panel>
  );
};

export default LiveFeed;
