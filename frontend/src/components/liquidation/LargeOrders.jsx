import React, { useMemo, useState } from 'react';
import usePolling from '../../lib/usePolling';
import { LoadingBlock } from '../ui/Skeleton';
import ScrollArea from '../ui/ScrollArea';
import { DEFAULT_MIN, ORDERFLOW, THIN_TEXT, WALL_MULTS, ageText, collectingText, eventCounts, flowNotice, largeStatus, suggestMin, tradeStats, wallImbalance } from './orderflow';
import { TRADE_THRESHOLDS, thresholdLabel } from './cvdCalc';
import { FUT, Notice, Panel, StaleNote, coin, fmtMarketPrice, fmtUsd } from './shared';
import { PriceLadder, ShareBar, StatCard, StatusPill, Sub, WhalePrints, chipCls, sideCls } from './LargeOrdersBits';

const TABS = [['trades', 'Trades'], ['walls', 'Walls'], ['events', 'Events']];
const OUTCOME = { appeared: ['Appeared', 'text-cyan-300'], pulled: ['Pulled', 'text-amber-400'], filled: ['Filled', 'text-slate-200'] };
const TH = 'px-2 py-1 font-medium';
const sgn = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const mult = (n) => (n >= 10 ? `${n.toFixed(0)}x` : `${n.toFixed(1)}x`);
// the same row can repeat (identical keys): disambiguate by occurrence so keys stay put across polls
const keyed = (rows, keyOf) => { const seen = new Map(); return rows.map((r) => { const k = keyOf(r); const n = seen.get(k) || 0; seen.set(k, n + 1); return [`${k}#${n}`, r]; }); };

const Head = ({ cols }) => (
  <thead className="sticky top-0 z-10 bg-slate-950 text-left text-[11px] uppercase tracking-wider text-slate-500">
    <tr>{cols.map(([c, right]) => <th key={c} scope="col" className={`${TH} ${right ? 'text-right' : ''}`}>{c}</th>)}</tr>
  </thead>
);
// price cell = the row's button: highlights the price on the ladder strip above
const PriceBtn = ({ price, on, pick, children }) => (
  <button type="button" aria-pressed={on} onClick={() => pick(price)} className={`focus-ring -mx-1 min-h-[44px] rounded px-1 text-right tabular-nums sm:min-h-0 ${on ? 'bg-amber-400/20 text-amber-200' : 'text-slate-200 hover:text-cyan-300'}`}>{children}</button>
);

// A proper "Large orders" tool: large taker trades (cvd trades route, USD chips) + resting walls and their lifecycle (order-flow collector).
const LargeOrders = ({ symbol }) => {
  const [min, setMin] = useState(DEFAULT_MIN);
  const [wallMult, setWallMult] = useState(10);
  const [tab, setTab] = useState('trades');
  const [sel, setSel] = useState(null);
  const flowP = usePolling(`${ORDERFLOW}/large/${symbol}`, 5000, undefined, undefined, true);
  const trP = usePolling(`${FUT}/cvd/${symbol}/trades?min=${min}`, 5000, undefined, undefined, true);
  const flow = flowP.data && flowP.data.symbol === symbol && flowP.data.status ? flowP.data : null;
  const tr = trP.data && trP.data.symbol === symbol && trP.data.available && Array.isArray(trP.data.items) ? trP.data : null;
  const u = coin(symbol);
  const noFutures = flowP.error?.response?.status === 404 && trP.error?.response?.status === 404;
  const [pill, tone] = largeStatus(flow, flowP.error, trP.data);
  const price = flow?.price || tr?.items?.[0]?.price || 0;
  const th = flow?.thresholds;
  const walledUp = flow && (flow.status === 'ok' || flow.status === 'stale');
  const medLevel = th?.medianLevelUsd || 0;

  const trades = tr ? tr.items : [];
  const walls = useMemo(() => (walledUp && Array.isArray(flow.levels) ? flow.levels.filter((l) => l.mult >= wallMult) : []), [flow, walledUp, wallMult]);
  const upFor = useMemo(() => new Map((flow?.activeWalls || []).map((w) => [`${w.side}:${w.price}`, w.upForMs])), [flow]);
  const events = flow?.wallEvents || [];
  const ts = tradeStats(trades);
  const wi = wallImbalance(walls);
  const ec = eventCounts(events);
  const topWall = walls[0] || (walledUp && flow.levels?.[0]) || null;
  const flow60 = tr?.flow60;
  const suggest = tr && trades.length === 0 ? suggestMin(tr.medianUsd, min, TRADE_THRESHOLDS) : null;
  const winMin = tr ? Math.max(1, Math.round(tr.windowMs / 60e3)) : 0;
  const now = Date.now();
  const pick = (p) => setSel((s) => (s === p ? null : p));
  const listed = tab === 'trades' ? trades.map((t) => t.price) : tab === 'walls' ? walls.map((w) => w.price) : events.map((e) => e.price);
  const waitNote = flow && flow.status === 'collecting' ? `${collectingText(flow.collectedMs)}.` : flow && flow.status === 'thin' ? THIN_TEXT : null;
  const busy = !flow && flowP.error?.response?.status === 503 && flowP.error.response.data?.error === 'collector_busy';

  const tabNote = (kind) => (
    waitNote || (busy ? flowNotice(flowP.error, null) : !flow ? (flowP.loading ? null : flowNotice(flowP.error, null) || 'No wall data yet.') : null) || (kind === 'walls' && walls.length === 0 ? `No resting level is ${wallMult}x the median level or more right now.` : kind === 'events' && events.length === 0 ? 'No wall has appeared, been pulled or been filled since collection began. A wall must stand 30 s before it is logged.' : null)
  );

  return (
    <Panel
      id="large-orders"
      title={`Large orders - ${u}`}
      right={<div className="flex items-center gap-2"><span className="rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-200">{u}USDT</span><StatusPill label={pill} tone={tone} /></div>}
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div role="group" aria-label="Trade size threshold" className="flex max-w-full items-center gap-1 overflow-x-auto">
          <span className="shrink-0 text-[11px] text-slate-500">Trades</span>
          {TRADE_THRESHOLDS.map((t) => <button key={t} type="button" aria-pressed={min === t} onClick={() => setMin(t)} className={chipCls(min === t)}>{`>=${thresholdLabel(t)}`}</button>)}
        </div>
        <div role="group" aria-label="Wall threshold" className="flex max-w-full items-center gap-1 overflow-x-auto">
          <span className="shrink-0 text-[11px] text-slate-500">Walls</span>
          {WALL_MULTS.map((m) => <button key={m} type="button" aria-pressed={wallMult === m} onClick={() => setWallMult(m)} className={chipCls(wallMult === m)}>{`${m}x`}</button>)}
        </div>
      </div>
      {flow?.stale && <StaleNote at={flow.generatedAt} />}
      {flow && !flow.stale && flowP.error && <StaleNote />}
      {flow?.source && flow.source !== 'binance-futures' && <p className="mb-2 text-xs text-amber-400">Book from {flow.source} perpetuals (Binance futures unavailable from this server); sizes differ from Binance.</p>}

      {noFutures ? <Notice>{flowNotice(flowP.error, null)}</Notice> : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3" data-testid="stat-cards">
            <StatCard label="Largest wall now">
              {topWall ? <><span className={sideCls(topWall.side)}>{topWall.side === 'bid' ? 'Bid' : 'Ask'}</span> {fmtUsd(topWall.usd)}<Sub>{fmtMarketPrice(topWall.price)}, {sgn(topWall.distPct)}{upFor.has(`${topWall.side}:${topWall.price}`) ? `, up ${ageText(upFor.get(`${topWall.side}:${topWall.price}`))}` : ''}</Sub></> : <Sub>None at 5x or more</Sub>}
            </StatCard>
            <StatCard label="Largest large trade">
              {ts.largest ? <><span className={sideCls(ts.largest.side)}>{ts.largest.side === 'buy' ? 'Buy' : 'Sell'}</span> {fmtUsd(ts.largest.usd)}<Sub>{fmtMarketPrice(ts.largest.price)}, {ageText(now - ts.largest.ts)} ago</Sub></> : <Sub>{tr ? `None >=${thresholdLabel(min)}` : 'No data'}</Sub>}
            </StatCard>
            <StatCard label="Net taker flow, 60 s">
              {flow60 ? <><span className={flow60.netUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{flow60.netUsd >= 0 ? '+' : '-'}{fmtUsd(Math.abs(flow60.netUsd))}</span>
                <ShareBar buy={flow60.buyUsd} sell={flow60.sellUsd} label={`Taker buys ${fmtUsd(flow60.buyUsd)}, sells ${fmtUsd(flow60.sellUsd)}`} />
                <Sub>Buys {fmtUsd(flow60.buyUsd)} / sells {fmtUsd(flow60.sellUsd)}, covers {Math.max(1, Math.round(flow60.coveredMs / 1000))} of 60 s</Sub></> : <Sub>No data</Sub>}
            </StatCard>
            <StatCard label="Large trades buy / sell">
              {tr && trades.length ? <>{ts.buyN} / {ts.sellN}<ShareBar buy={ts.buyUsd} sell={ts.sellUsd} label={`Large buys ${ts.buyShare.toFixed(0)} percent of USD`} /><Sub>{fmtUsd(ts.buyUsd)} vs {fmtUsd(ts.sellUsd)} ({ts.sellUsd > 0 ? `${(ts.buyUsd / ts.sellUsd).toFixed(2)}x` : 'no sells'})</Sub></> : <Sub>{tr ? 'No trades in view' : 'No data'}</Sub>}
            </StatCard>
            <StatCard label="Wall imbalance, 2%">
              {wi.imbalance != null ? <><span className={wi.imbalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{wi.imbalance >= 0 ? '+' : ''}{wi.imbalance.toFixed(0)}%</span><ShareBar buy={wi.bidUsd} sell={wi.askUsd} label="Bid wall USD versus ask wall USD" /><Sub>Bid {fmtUsd(wi.bidUsd)} vs ask {fmtUsd(wi.askUsd)}</Sub></> : <Sub>{walledUp ? `No ${wallMult}x walls within 2%` : 'No data'}</Sub>}
            </StatCard>
            <StatCard label="Walls pulled / filled">
              {flow ? <>{ec.pulled} / {ec.filled}<Sub>since collection began, {events.length === 0 ? 'none logged yet' : `${ec.pulled + ec.filled} ended`}</Sub></> : <Sub>No data</Sub>}
            </StatCard>
          </div>

          <div role="tablist" aria-label="Large orders view" className="mt-3 flex gap-1 overflow-x-auto border-b border-slate-800/80">
            {TABS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} id={`lo-tab-${k}`} aria-controls="lo-panel" onClick={() => setTab(k)} className={`focus-ring min-h-[44px] shrink-0 px-4 text-xs font-medium ${tab === k ? 'border-b-2 border-cyan-400 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
            ))}
          </div>
          <div role="tabpanel" id="lo-panel" aria-labelledby={`lo-tab-${tab}`} className="mt-2">
            <PriceLadder ref0={price} prices={listed.slice(0, 60)} selected={sel} />
            {tab === 'trades' ? (
              !tr ? (trP.loading ? <LoadingBlock height={160} /> : <Notice tone={trP.error ? 'error' : 'muted'}>{trP.data?.available === false ? `Recent trades are unavailable from this source: ${trP.data.reason}` : 'Recent trades are unavailable right now.'}</Notice>)
                : trades.length === 0 ? (
                  <Notice>
                    <span role="status">No trades above {fmtUsd(min)} in the last {winMin} min, try a lower threshold.</span>
                    {suggest && <><br /><button type="button" onClick={() => setMin(suggest)} className="focus-ring mt-2 min-h-[44px] rounded-md border border-cyan-500/40 px-3 text-xs text-cyan-300">Try &gt;={thresholdLabel(suggest)} (median trade here is {fmtUsd(tr.medianUsd)})</button></>}
                  </Notice>
                ) : (
                  <ScrollArea label={`Large trades for ${u}`} footer={`${trades.length} trades of ${thresholdLabel(min)}+ from the latest ${tr.count}, newest first`}>
                    <table className="w-full min-w-[380px] text-xs tabular-nums">
                      <caption className="sr-only">Large trades for {u}</caption>
                      <Head cols={[['Side'], ['Price', 1], ['USD', 1], ['x median', 1], ['Age', 1]]} />
                      <tbody>
                        {keyed(trades, (t) => `t${t.id}`).map(([k, t]) => (
                          <tr key={k} className={`border-t border-slate-800/60 text-slate-200 ${sel === t.price ? 'bg-amber-400/10' : t.usd >= 5 * min ? 'bg-slate-800/40 font-semibold' : ''}`}>
                            <td className={`px-2 py-1 ${sideCls(t.side)}`}>{t.side === 'buy' ? 'Taker buy' : 'Taker sell'}</td>
                            <td className="px-2 py-1 text-right"><PriceBtn price={t.price} on={sel === t.price} pick={pick}>{fmtMarketPrice(t.price)}</PriceBtn></td>
                            <td className="px-2 py-1 text-right">{fmtUsd(t.usd)}</td>
                            <td className="px-2 py-1 text-right">{tr.medianUsd > 0 ? mult(t.usd / tr.medianUsd) : '--'}</td>
                            <td className="px-2 py-1 text-right text-slate-400">{ageText(now - t.ts)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                )
            ) : tabNote(tab) ? (flowP.loading && !flow ? <LoadingBlock height={160} /> : <Notice tone={!flow && flowP.error ? 'error' : 'muted'}><span role="status">{tabNote(tab)}</span></Notice>)
              : tab === 'walls' ? (
                <ScrollArea label={`Walls for ${u}`} footer={`${walls.length} resting levels at ${wallMult}x the median or more, biggest first`}>
                  <table className="w-full min-w-[380px] text-xs tabular-nums">
                    <caption className="sr-only">Resting walls for {u}</caption>
                    <Head cols={[['Side'], ['Price', 1], ['USD', 1], ['x median', 1], ['Up for', 1]]} />
                    <tbody>
                      {keyed(walls, (w) => `${w.side}:${w.price}`).map(([k, w]) => (
                        <tr key={k} className={`border-t border-slate-800/60 text-slate-200 ${sel === w.price ? 'bg-amber-400/10' : ''}`}>
                          <td className={`px-2 py-1 ${sideCls(w.side)}`}>{w.side === 'bid' ? 'Bid' : 'Ask'}</td>
                          <td className="px-2 py-1 text-right"><PriceBtn price={w.price} on={sel === w.price} pick={pick}>{fmtMarketPrice(w.price)} <span className="text-slate-500">({sgn(w.distPct)})</span></PriceBtn></td>
                          <td className="px-2 py-1 text-right">{fmtUsd(w.usd)}</td>
                          <td className="px-2 py-1 text-right">{mult(w.mult)}</td>
                          <td className="px-2 py-1 text-right text-slate-400">{upFor.has(`${w.side}:${w.price}`) ? ageText(upFor.get(`${w.side}:${w.price}`)) : 'new'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              ) : (
                <ScrollArea label={`Wall events for ${u}`} footer={`${events.length} events since collection began, newest first (last 200 kept)`}>
                  <table className="w-full min-w-[380px] text-xs tabular-nums">
                    <caption className="sr-only">Wall events for {u}</caption>
                    <Head cols={[['Event'], ['Side'], ['Price', 1], ['USD', 1], ['x median', 1], ['Age', 1]]} />
                    <tbody>
                      {keyed(events, (e) => `${e.t}-${e.side}-${e.price}-${e.outcome}`).map(([k, e]) => {
                        const [lab, cls] = OUTCOME[e.outcome] || [e.outcome, ''];
                        return (
                          <tr key={k} className={`border-t border-slate-800/60 text-slate-200 ${sel === e.price ? 'bg-amber-400/10' : ''}`}>
                            <td className={`px-2 py-1 ${cls}`}>{lab}{e.outcome !== 'appeared' && e.lifetimeMs > 0 && <span className="ml-1 text-slate-500">after {ageText(e.lifetimeMs)}</span>}</td>
                            <td className={`px-2 py-1 ${sideCls(e.side)}`}>{e.side === 'bid' ? 'Bid' : 'Ask'}</td>
                            <td className="px-2 py-1 text-right"><PriceBtn price={e.price} on={sel === e.price} pick={pick}>{fmtMarketPrice(e.price)}</PriceBtn></td>
                            <td className="px-2 py-1 text-right">{fmtUsd(e.usd)}</td>
                            <td className="px-2 py-1 text-right">{medLevel > 0 ? mult(e.usd / medLevel) : '--'}</td>
                            <td className="px-2 py-1 text-right text-slate-400">{ageText(now - e.t)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
          </div>

          {tr && tr.perMin?.length > 0 && <WhalePrints bars={tr.perMin || []} windowMs={tr.windowMs} minLabel={fmtUsd(min)} />}

          <p className="mt-3 text-[11px] text-slate-500">
            Descriptive, not advice. Large trades are taker prints from the Binance futures tape; walls are resting orders (levels at least {wallMult}x the median level) and can be pulled at any moment (spoofing). The sides of a trade are the taker's.
            {th && ` Median level ${fmtUsd(th.medianLevelUsd)}.`} {flow ? `${collectingText(flow.collectedMs)}; wall data refreshes every 5 s.` : ''}
          </p>
        </>
      )}
    </Panel>
  );
};

export default LargeOrders;
