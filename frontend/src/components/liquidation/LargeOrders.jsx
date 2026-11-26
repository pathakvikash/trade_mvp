import React from 'react';
import usePolling from '../../lib/usePolling';
import { LoadingBlock } from '../ui/Skeleton';
import { ORDERFLOW, THIN_TEXT, collectingText, flowNotice } from './orderflow';
import { Notice, Panel, StaleNote, coin, fmtMarketPrice, fmtTime, fmtUsd } from './shared';

const KIND = { wall: 'Wall', trade: 'Trade' };
// wall sides are bid/ask (resting); trade sides are the taker's side
const SIDE = { bid: ['Bid', 'text-emerald-400'], ask: ['Ask', 'text-rose-400'], buy: ['Taker buy', 'text-emerald-400'], sell: ['Taker sell', 'text-rose-400'] };

// Unusually large resting levels ("walls") on the latest book snapshot and unusually large recent trades from the tape.
const LargeOrders = ({ symbol }) => {
  const { data, error, loading } = usePolling(`${ORDERFLOW}/large/${symbol}`, 5000, undefined, undefined, true);
  const ok = !!data && data.symbol === symbol && Array.isArray(data.items);
  const notice = flowNotice(error, data);
  const th = data?.thresholds;
  const u = coin(symbol);
  const seen = new Map(); // the feed has no trade id: disambiguate identical kind/side/price/ts rows by occurrence
  const waiting = ok && (data.status === 'collecting' || data.status === 'thin');
  return (
    <Panel id="large-orders" title={`Large orders - ${u}`}>
      <p className="mb-2 text-xs text-slate-400">
        Descriptive, not advice. A <strong>wall</strong> is a resting book level at least {th?.wallMult ?? 10}x the median level of the latest snapshot; a <strong>trade</strong> is a recent trade at least {th?.tradeMult ?? 10}x the median recent trade. Resting orders can be cancelled at any time (spoofing).
      </p>
      {ok && data.stale && <StaleNote at={data.generatedAt} />}
      {ok && !data.stale && error && <StaleNote />}
      {data?.source && data.source !== 'binance-futures' && <p className="mb-2 text-xs text-amber-400">From {data.source} perpetuals (Binance futures unavailable from this server); sizes differ from Binance.</p>}
      {!ok || waiting ? (
        loading ? <LoadingBlock height={160} /> : <Notice tone={error ? 'error' : 'muted'}><span role="status">{waiting ? (data.status === 'thin' ? THIN_TEXT : `${collectingText(data.collectedMs)}.`) : notice || 'No data yet.'}</span></Notice>
      ) : (
        <>
          {data.tradesSeen < th.tradesNeeded && <p className="mb-2 text-xs text-slate-400" role="status">{collectingText(data.collectedMs)}: {data.tradesSeen} of {th.tradesNeeded} recent trades seen, so large trades are not listed yet.</p>}
          {data.items.length === 0 ? (
            <Notice>No level or trade is above the threshold right now.</Notice>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs tabular-nums">
                <caption className="sr-only">Large orders for {u}</caption>
                <thead className="text-left text-slate-500">
                  <tr><th scope="col" className="py-1.5 pr-2 font-medium">Type</th><th scope="col" className="px-2 font-medium">Side</th><th scope="col" className="px-2 text-right font-medium">Price</th><th scope="col" className="px-2 text-right font-medium">Size</th><th scope="col" className="px-2 text-right font-medium">x median</th><th scope="col" className="pl-2 text-right font-medium">Time</th></tr>
                </thead>
                <tbody>
                  {data.items.map((i) => {
                    const [side, cls] = SIDE[i.side] || [i.side, ''];
                    const base = i.id ?? `${i.kind}-${i.side}-${i.price}-${i.ts}`;
                    const n = seen.get(base) || 0; seen.set(base, n + 1);
                    return (
                      <tr key={`${base}#${n}`} className="border-t border-slate-800/80 text-slate-200">
                        <td className="py-1.5 pr-2"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${i.kind === 'wall' ? 'bg-cyan-400/10 text-cyan-300' : 'bg-slate-800 text-slate-300'}`}>{KIND[i.kind]}</span></td>
                        <td className={`px-2 ${cls}`}>{side}</td>
                        <td className="px-2 text-right">{fmtMarketPrice(i.price)}{i.kind === 'wall' && <span className="ml-1 text-slate-500">({i.distPct >= 0 ? '+' : ''}{i.distPct.toFixed(2)}%)</span>}</td>
                        <td className="px-2 text-right">{fmtUsd(i.usd)}</td>
                        <td className="px-2 text-right">{i.mult.toFixed(0)}x</td>
                        <td className="pl-2 text-right text-slate-400">{fmtTime(i.ts)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            Median level {fmtUsd(th.medianLevelUsd)}{th.medianTradeUsd > 0 && `, median trade ${fmtUsd(th.medianTradeUsd)}`}. Wall times are the snapshot they were seen in; trade times are the exchange's. Refreshes every 5 s; {collectingText(data.collectedMs).toLowerCase()}.
          </p>
        </>
      )}
    </Panel>
  );
};

export default LargeOrders;
