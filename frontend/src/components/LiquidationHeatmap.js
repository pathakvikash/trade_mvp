import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useFuturesStore from '../store/futuresStore';
import usePolling from '../lib/usePolling';
import useCanvas from './liquidation/useCanvas';
import { bucketLiquidations } from './liquidation/bucket';
import SegTabs from './ui/SegTabs';
import { FUT, Panel, coin, fmtPrice, fmtTime, fmtUsd } from './liquidation/shared';

// Window -> kline interval and column count (one column per candle).
const WINDOWS = {
  '1h': { ms: 3600e3, iv: '1m', cols: 60 },
  '6h': { ms: 6 * 3600e3, iv: '5m', cols: 72 },
  '24h': { ms: 24 * 3600e3, iv: '15m', cols: 96 },
};
const ROWS = 40;
const H = 320;
const NONE = [];
const RIGHT = 62;
const BOTTOM = 20;
const LONG = '52, 211, 153'; // emerald: longs liquidated
const SHORT = '251, 113, 133'; // rose: shorts liquidated

const WIN_TABS = Object.keys(WINDOWS).map((id) => ({ id, label: id }));

const LiquidationHeatmap = ({ symbol }) => {
  const subscribe = useFuturesStore((s) => s.subscribe);
  const unsubscribe = useFuturesStore((s) => s.unsubscribe);
  const fSymbol = useFuturesStore((s) => s.symbol);
  const liquidations = useFuturesStore((s) => s.liquidations);
  const mark = useFuturesStore((s) => s.mark);
  const since = useFuturesStore((s) => s.since);
  const error = useFuturesStore((s) => s.error);
  const [win, setWin] = useState('24h');
  const [hover, setHover] = useState(null);
  const cfg = WINDOWS[win];

  useEffect(() => { subscribe(symbol); }, [symbol, subscribe]);
  useEffect(() => unsubscribe, [unsubscribe]);

  const kl = usePolling(`${FUT}/klines/${symbol}?interval=${cfg.iv}&limit=${cfg.cols}`, 60000);
  const klines = useMemo(() => (Array.isArray(kl.data) ? kl.data : []), [kl.data]);
  const events = fSymbol === symbol ? liquidations : NONE;
  const markPrice = fSymbol === symbol && mark ? mark.markPrice : null;

  const grid = useMemo(() => {
    const step = cfg.ms / cfg.cols;
    const t1 = Math.ceil(Date.now() / step) * step;
    const prices = [];
    klines.forEach((k) => prices.push(k.high, k.low));
    if (markPrice) prices.push(markPrice);
    let lo;
    let hi;
    if (prices.length) {
      lo = Math.min(...prices);
      hi = Math.max(...prices);
      const pad = (hi - lo) * 0.02 || hi * 0.005;
      lo -= pad;
      hi += pad;
    }
    return bucketLiquidations(events, { t0: t1 - cfg.ms, t1, cols: cfg.cols, rows: ROWS, lo, hi });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, klines, markPrice, win]);

  const draw = useCallback((ctx, W, Ht) => {
    const pw = W - RIGHT;
    const ph = Ht - BOTTOM;
    const cw = pw / grid.cols;
    const ch = ph / grid.rows;
    const max = Math.max(grid.maxLong, grid.maxShort) || 1;
    const X = (t) => ((t - grid.t0) / (grid.t1 - grid.t0)) * pw;
    const Y = (p) => ph - ((p - grid.lo) / (grid.hi - grid.lo)) * ph;
    ctx.clearRect(0, 0, W, Ht);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(0, 0, pw, ph);
    // Long on the left half of a cell, short on the right half
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        const i = r * grid.cols + c;
        const y = ph - (r + 1) * ch;
        if (grid.long[i] > 0) {
          ctx.fillStyle = `rgba(${LONG}, ${0.15 + 0.85 * Math.sqrt(grid.long[i] / max)})`;
          ctx.fillRect(c * cw, y, cw / 2, ch);
        }
        if (grid.short[i] > 0) {
          ctx.fillStyle = `rgba(${SHORT}, ${0.15 + 0.85 * Math.sqrt(grid.short[i] / max)})`;
          ctx.fillRect(c * cw + cw / 2, y, cw / 2, ch);
        }
      }
    }
    // Price line (kline closes at candle mid-time)
    if (klines.length) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      klines.forEach((k, i) => {
        const x = X(k.time * 1000);
        if (i) ctx.lineTo(x, Y(k.close)); else ctx.moveTo(x, Y(k.close));
      });
      ctx.stroke();
    }
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillStyle = '#94a3b8';
    if (markPrice) {
      ctx.strokeStyle = '#fbbf24';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Y(markPrice));
      ctx.lineTo(pw, Y(markPrice));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(fmtPrice(markPrice), pw + 4, Y(markPrice) + 3);
    }
    ctx.fillStyle = '#94a3b8';
    for (let i = 0; i <= 4; i += 1) {
      const p = grid.lo + ((grid.hi - grid.lo) * i) / 4;
      const y = Math.min(ph - 2, Math.max(8, Y(p)));
      if (!markPrice || Math.abs(y - Y(markPrice)) > 11) ctx.fillText(fmtPrice(p), pw + 4, y + 3);
    }
    for (let i = 0; i <= 3; i += 1) {
      const t = grid.t0 + ((grid.t1 - grid.t0) * i) / 3;
      ctx.textAlign = i === 3 ? 'right' : i === 0 ? 'left' : 'center';
      ctx.fillText(new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), (pw * i) / 3, Ht - 5);
    }
    ctx.textAlign = 'left';
  }, [grid, klines, markPrice]);

  const { wrap, canvas } = useCanvas(draw, H);

  const onMove = (e) => {
    const b = canvas.current.getBoundingClientRect();
    const x = e.clientX - b.left;
    const y = e.clientY - b.top;
    const pw = b.width - RIGHT;
    const ph = H - BOTTOM;
    if (x < 0 || x >= pw || y < 0 || y >= ph) { setHover(null); return; }
    setHover({ c: Math.floor((x / pw) * grid.cols), r: Math.floor(((ph - y) / ph) * grid.rows), x, y, w: b.width });
  };

  const hv = hover && (() => {
    const step = (grid.t1 - grid.t0) / grid.cols;
    const pstep = (grid.hi - grid.lo) / grid.rows;
    const i = hover.r * grid.cols + hover.c;
    return {
      time: `${fmtTime(grid.t0 + hover.c * step)} - ${fmtTime(grid.t0 + (hover.c + 1) * step)}`,
      price: `${fmtPrice(grid.lo + hover.r * pstep)} - ${fmtPrice(grid.lo + (hover.r + 1) * pstep)}`,
      long: grid.long[i],
      short: grid.short[i],
    };
  })();

  const label = `${coin(symbol)} liquidation heatmap, last ${win}: ${grid.count} sampled events, longs liquidated ${fmtUsd(grid.longUsd)}, shorts liquidated ${fmtUsd(grid.shortUsd)}`;
  const partial = since && since > grid.t0;

  return (
    <Panel
      title={`Realized liquidations (sampled) - ${coin(symbol)}`}
      right={<SegTabs label="Heatmap window" tabs={WIN_TABS} active={win} onChange={(w) => { setWin(w); setHover(null); }} />}
    >
      {error && <p className="mb-2 text-xs text-amber-400">{error === 'no_market' ? 'No futures market for this symbol.' : 'Could not load liquidation history; showing live events only.'}</p>}
      <div ref={wrap} className="relative">
        <canvas ref={canvas} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block" />
        {grid.count === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 px-4 text-center text-sm text-slate-400">
            No liquidations sampled in this window{since ? ` (history since ${fmtTime(since)})` : ''}.
          </p>
        )}
        {hv && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200 shadow"
            style={{ left: Math.min(hover.x + 12, hover.w - 190), top: Math.max(0, hover.y - 64) }}
          >
            <div>{hv.time}</div>
            <div className="text-slate-400">{hv.price}</div>
            <div className="text-emerald-400">Longs liquidated {fmtUsd(hv.long)}</div>
            <div className="text-rose-400">Shorts liquidated {fmtUsd(hv.short)}</div>
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span><i className="mr-1 inline-block h-2 w-2 bg-emerald-400" />Left half of each cell: longs liquidated</span>
        <span><i className="mr-1 inline-block h-2 w-2 bg-rose-400" />Right half: shorts liquidated</span>
        <span className="inline-flex items-center gap-1">low<i className="inline-block h-2 w-16 bg-gradient-to-r from-slate-400/20 to-slate-100" />high USD</span>
        <span><i className="mr-1 inline-block h-0.5 w-4 bg-slate-200 align-middle" />price <i className="ml-2 mr-1 inline-block h-0.5 w-4 border-t border-dashed border-amber-400 align-middle" />mark</span>
      </div>
      {partial && <p className="mt-1 text-[11px] text-amber-400">History only goes back to {fmtTime(since)}, so this window is only partly covered.</p>}
    </Panel>
  );
};

export default LiquidationHeatmap;
