import React, { useEffect, useMemo, useRef, useState } from 'react';
import Panel from '../ui/Panel';
import { fmtMarketPrice, fmtQty } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';

const DEPTH = 14; // levels per side when the panel is not height-bound (below xl)
const ROW_PX = 18; // one level: text-xs line (16px) + py-px
const CHROME_PX = 72; // column header + spread row + margins
const XL = '(min-width: 1280px)';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// levels are best-first [price, size]; adds running (cumulative) size from the best level outward
const withCum = (levels, n) => {
  let cum = 0;
  return (levels || []).slice(0, n).map(([price, size]) => {
    cum += Number(size);
    return { price, size: Number(size), cum };
  });
};

const Row = ({ level, max, text, bar }) => (
  <div className="relative grid grid-cols-3 px-3 py-px text-xs tabular-nums">
    <span className={`absolute inset-y-0 right-0 ${bar}`} style={{ width: `${(level.cum / max) * 100}%` }} aria-hidden="true" />
    <span className={`relative ${text}`}>{fmtMarketPrice(level.price)}</span>
    <span className="relative text-right text-slate-300">{fmtQty(level.size)}</span>
    <span className="relative text-right text-slate-500">{fmtQty(level.cum)}</span>
  </div>
);

const OrderBookPanel = ({ book, loading, className = '' }) => {
  const boxRef = useRef(null);
  const [perSide, setPerSide] = useState(DEPTH);

  // At xl the panel has a set height: show as many levels per side as fit (same count on both sides).
  // Below xl the panel grows with its content, so it keeps the fixed depth.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const fit = () => {
      const wide = typeof window.matchMedia === 'function' && window.matchMedia(XL).matches;
      setPerSide(wide ? clamp(Math.floor((el.clientHeight - CHROME_PX) / 2 / ROW_PX), 1, DEPTH) : DEPTH);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { asks, bids, max, spread, bps } = useMemo(() => {
    const a = withCum(book?.asks, perSide);
    const b = withCum(book?.bids, perSide);
    const sp = a.length && b.length ? Number(a[0].price) - Number(b[0].price) : null;
    const mid = sp == null ? null : (Number(a[0].price) + Number(b[0].price)) / 2;
    return {
      asks: a,
      bids: b,
      max: Math.max(a[a.length - 1]?.cum || 0, b[b.length - 1]?.cum || 0) || 1,
      spread: sp,
      bps: mid ? (sp / mid) * 1e4 : null,
    };
  }, [book, perSide]);

  return (
    <Panel title="Order book" className={className} bodyClassName="min-h-0 overflow-hidden p-0 pb-1.5">
      <div ref={boxRef} className="flex h-full min-h-0 flex-col overflow-hidden">
        {asks.length === 0 && bids.length === 0 ? (
          loading ? (
            <div className="space-y-1.5 px-3 pt-2" aria-busy="true" aria-label="Loading order book">
              {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-3 w-full" />)}
            </div>
          ) : <p className="px-3 pt-2 text-xs text-slate-500">No live order book for this market.</p>
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-3 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-slate-500">
              <span>Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Total</span>
            </div>
            {/* asks farthest first so the best ask sits next to the spread; spare height shows above the asks */}
            <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
              {[...asks].reverse().map((l) => (
                <Row key={l.price} level={l} max={max} text="text-rose-400" bar="bg-rose-400/10" />
              ))}
            </div>
            <div className="my-1 flex shrink-0 items-center justify-between border-y border-slate-800/80 px-3 py-1 text-[11px] tabular-nums text-slate-400">
              <span>Spread</span>
              <span className="text-slate-200">
                {spread == null ? '--' : `$${fmtMarketPrice(spread)}`}
                {bps != null && <span className="text-slate-500"> · {bps.toFixed(2)} bps</span>}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col justify-start overflow-hidden">
              {bids.map((l) => (
                <Row key={l.price} level={l} max={max} text="text-emerald-400" bar="bg-emerald-400/10" />
              ))}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
};

export default OrderBookPanel;
