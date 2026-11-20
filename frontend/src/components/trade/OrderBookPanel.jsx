import React, { useMemo } from 'react';
import Panel from '../ui/Panel';
import { fmtPrice, fmtQty } from '../ui/fmt';

const DEPTH = 12;

// levels are best-first [price, size]; adds running (cumulative) size from the best level outward
const withCum = (levels) => {
  let cum = 0;
  return (levels || []).slice(0, DEPTH).map(([price, size]) => {
    cum += Number(size);
    return { price, size: Number(size), cum };
  });
};

const Row = ({ level, max, text, bar }) => (
  <div className="relative grid grid-cols-3 px-3 py-px text-xs tabular-nums">
    <span className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${(level.cum / max) * 100}%` }} aria-hidden="true" />
    <span className={`relative ${text}`}>{fmtPrice(level.price)}</span>
    <span className="relative text-right text-slate-300">{fmtQty(level.size)}</span>
    <span className="relative text-right text-slate-500">{fmtQty(level.cum)}</span>
  </div>
);

const OrderBookPanel = ({ book, loading, className = '' }) => {
  const { asks, bids, max, spread, bps } = useMemo(() => {
    const a = withCum(book?.asks);
    const b = withCum(book?.bids);
    const sp = a.length && b.length ? Number(a[0].price) - Number(b[0].price) : null;
    const mid = sp == null ? null : (Number(a[0].price) + Number(b[0].price)) / 2;
    return {
      asks: a,
      bids: b,
      max: Math.max(a[a.length - 1]?.cum || 0, b[b.length - 1]?.cum || 0) || 1,
      spread: sp,
      bps: mid ? (sp / mid) * 1e4 : null,
    };
  }, [book]);

  return (
    <Panel title="Order book" className={className} bodyClassName="min-h-0 p-0 pb-1.5">
      {asks.length === 0 && bids.length === 0 ? (
        <p className="px-3 pt-2 text-xs text-slate-500">{loading ? 'Loading order book…' : 'No live order book for this market.'}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-500">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>
          {/* asks farthest first so the best ask sits next to the best bid */}
          {[...asks].reverse().map((l) => (
            <Row key={l.price} level={l} max={max} text="text-rose-400" bar="bg-rose-400/10" />
          ))}
          <div className="my-1 flex items-center justify-between border-y border-slate-800/80 px-3 py-1 text-[11px] tabular-nums text-slate-400">
            <span>Spread</span>
            <span className="text-slate-200">
              {spread == null ? '--' : `$${fmtPrice(spread)}`}
              {bps != null && <span className="text-slate-500"> · {bps.toFixed(2)} bps</span>}
            </span>
          </div>
          {bids.map((l) => (
            <Row key={l.price} level={l} max={max} text="text-emerald-400" bar="bg-emerald-400/10" />
          ))}
        </>
      )}
    </Panel>
  );
};

export default OrderBookPanel;
