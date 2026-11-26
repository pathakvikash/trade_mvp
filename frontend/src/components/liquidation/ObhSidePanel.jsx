import React, { useEffect, useRef, useState } from 'react';
import SegTabs from '../ui/SegTabs';
import ScrollArea from '../ui/ScrollArea';
import { OUTCOME, fmtDur, fmtUnit, distText } from './obh';
import { Notice, coin, fmtMarketPrice, fmtTime, fmtUsd } from './shared';

const TABS = [{ id: 'book', label: 'Book' }, { id: 'walls', label: 'Walls' }, { id: 'events', label: 'Wall events' }];
const th = 'px-2 py-1 font-medium';
const HEAD = 'sticky top-0 z-10 bg-slate-950 text-[11px] uppercase tracking-wider text-slate-500';
const BID = 'text-emerald-400';
const ASK = 'text-orange-400';
const TONE = { appeared: 'bg-cyan-400/10 text-cyan-300', pulled: 'bg-amber-400/10 text-amber-300', filled: 'bg-emerald-400/10 text-emerald-300' };

// Depth bar behind the cumulative cell: width = cumulative / the larger side's total.
const bar = (pct, rgb) => ({ background: `linear-gradient(to left, rgba(${rgb},0.22) ${pct}%, transparent ${pct}%)` });

// Latest book: asks (far to near), a spread row, bids (near to far). Scrolled to the spread once when it opens (not on each poll).
const Book = ({ d, unit }) => {
  const spread = useRef(null);
  useEffect(() => {
    const row = spread.current;
    const box = row?.closest('[role=region]');
    if (box) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2);
  }, []);
  const { bids, asks, spread: sp, spreadPct } = d.book;
  const cumOf = (l) => (unit === 'qty' ? l.cumQty : l.cumUsd);
  const total = Math.max(1, cumOf(bids[bids.length - 1] || {}) || 0, cumOf(asks[asks.length - 1] || {}) || 0);
  const row = (l, cls, rgb) => (
    <tr key={`${cls}${l.price}`} className="border-t border-slate-800/40 text-slate-200">
      <td className={`px-2 py-0.5 ${cls}`}>{fmtMarketPrice(l.price)}</td>
      <td className="px-2 py-0.5 text-right">{fmtUnit(l.qty, 'qty')}</td>
      <td className="px-2 py-0.5 text-right">{fmtUsd(l.usd)}</td>
      <td className="px-2 py-0.5 text-right" style={bar((cumOf(l) / total) * 100, rgb)}>{fmtUnit(cumOf(l), unit)}</td>
    </tr>
  );
  return (
    <ScrollArea label={`Latest order book for ${coin(d.symbol)}`} footer={`Latest snapshot, grouped by ${fmtMarketPrice(d.priceStep / d.grid)}. Cumulative counts outward from the spread.`}>
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">Latest order book</caption>
        <thead className={HEAD}><tr><th scope="col" className={`${th} text-left`}>Price</th><th scope="col" className={`${th} text-right`}>Size</th><th scope="col" className={`${th} text-right`}>Value</th><th scope="col" className={`${th} text-right`}>Cumulative</th></tr></thead>
        <tbody>
          {[...asks].reverse().map((l) => row(l, ASK, '251,146,60'))}
          <tr ref={spread} data-testid="spread-row" className="border-y border-slate-700 bg-slate-900 text-center text-slate-300">
            <td colSpan={4} className="px-2 py-1">Spread {fmtMarketPrice(sp)} ({spreadPct.toFixed(3)}%)</td>
          </tr>
          {bids.map((l) => row(l, BID, '52,211,153'))}
        </tbody>
      </table>
    </ScrollArea>
  );
};

const Walls = ({ d }) => (d.walls.active.length === 0 ? (
  <Notice>No wall at {d.walls.thresholdMult}x the median level right now.</Notice>
) : (
  <ScrollArea label={`Current walls for ${coin(d.symbol)}`} footer={`A wall is a level at least ${d.walls.thresholdMult}x the median level. "Up for" counts from when we first saw it.`}>
    <table className="w-full text-xs tabular-nums">
      <caption className="sr-only">Current walls</caption>
      <thead className={HEAD}><tr><th scope="col" className={`${th} text-left`}>Side</th><th scope="col" className={`${th} text-right`}>Price</th><th scope="col" className={`${th} text-right`}>Size</th><th scope="col" className={`${th} text-right`}>From price</th><th scope="col" className={`${th} text-right`}>Up for</th></tr></thead>
      <tbody>
        {d.walls.active.map((w) => (
          <tr key={`${w.side}${w.price}`} className="border-t border-slate-800/40 text-slate-200">
            <td className={`px-2 py-1 ${w.side === 'bid' ? BID : ASK}`}>{w.side === 'bid' ? 'Bid' : 'Ask'}</td>
            <td className="px-2 py-1 text-right">{fmtMarketPrice(w.price)}</td>
            <td className="px-2 py-1 text-right">{fmtUsd(w.usd)}</td>
            <td className="px-2 py-1 text-right text-slate-400">{distText(w.distPct).replace(' from price', '')}</td>
            <td className="px-2 py-1 text-right text-slate-400">{fmtDur(w.upForMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </ScrollArea>
));

const Events = ({ d }) => (d.wallEvents.length === 0 ? (
  <Notice>No wall has appeared, been pulled or been filled since collection started.</Notice>
) : (
  <ScrollArea label={`Wall events for ${coin(d.symbol)}`} footer={`Newest first, last ${d.wallEvents.length}. Pulled = gone before price reached it; filled = price traded through it.`}>
    <table className="w-full text-xs tabular-nums">
      <caption className="sr-only">Wall events</caption>
      <thead className={HEAD}><tr><th scope="col" className={`${th} text-left`}>Time</th><th scope="col" className={`${th} text-left`}>Event</th><th scope="col" className={`${th} text-right`}>Price</th><th scope="col" className={`${th} text-right`}>Size</th><th scope="col" className={`${th} text-right`}>Lasted</th></tr></thead>
      <tbody>
        {d.wallEvents.map((e, i) => (
          <tr key={`${e.t}${e.side}${e.price}${e.outcome}${i}`} className="border-t border-slate-800/40 text-slate-200">
            <td className="px-2 py-1 text-slate-400">{fmtTime(e.t)}</td>
            <td className="px-2 py-1"><span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${TONE[e.outcome]}`}>{OUTCOME[e.outcome]}</span> <span className={e.side === 'bid' ? BID : ASK}>{e.side === 'bid' ? 'Bid' : 'Ask'}</span></td>
            <td className="px-2 py-1 text-right">{fmtMarketPrice(e.price)}</td>
            <td className="px-2 py-1 text-right">{fmtUsd(e.usd)}</td>
            <td className="px-2 py-1 text-right text-slate-400">{e.outcome === 'appeared' ? '--' : fmtDur(e.lifetimeMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </ScrollArea>
));

// Right side panel (stacked under the chart below 1024px): Book / Walls / Wall events.
const ObhSidePanel = ({ d, unit }) => {
  const [tab, setTab] = useState('book');
  return (
    <aside aria-label="Order book details" className="min-w-0">
      <SegTabs label="Order book details" tabs={TABS} active={tab} onChange={setTab} className="mb-2 [&_button]:min-h-[44px] sm:[&_button]:min-h-0" />
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab).label}>
        {tab === 'book' && <Book d={d} unit={unit} />}
        {tab === 'walls' && <Walls d={d} />}
        {tab === 'events' && <Events d={d} />}
      </div>
    </aside>
  );
};

export default ObhSidePanel;
