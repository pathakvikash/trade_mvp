import React, { useLayoutEffect, useRef } from 'react';
import { heatCss, scaleT } from './heat';
import { fmtPct, fmtPrice, fmtUsd } from './shared';

const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayTime = (t) => `${new Date(t).toLocaleDateString([], { month: '2-digit', day: '2-digit' })} ${hhmm(t)}`;
const dur = (ms) => {
  const m = Math.round(ms / 60000);
  if (m <= 0) return null;
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
const usd = (v) => (v > 0 ? fmtUsd(v) : '—');

// Hover card for one heatmap cell (a 5 column x 7 row window of estimated USD values around the cursor).
// cursor: see buildCursor in heat.js. anchor {x, y}: viewport position of the pointer; the card sits beside it and flips
// to stay inside the viewport. palette/bottom/top colour the grid like the heatmap. It never takes pointer events
// (the touch close button is the one exception). z-40: under the AI dock (z-50).
const HeatHoverCard = ({ cursor, anchor, id, palette = 'viridis', bottom = 0, top = 0, touch = false, onClose }) => {
  const node = useRef(null);
  useLayoutEffect(() => {
    const n = node.current;
    if (!n || !anchor) return;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const w = n.offsetWidth;
    const h = n.offsetHeight;
    const gap = 14;
    const x = anchor.x + gap + w <= vw - 4 ? anchor.x + gap : anchor.x - gap - w; // flip to the left near the right edge
    n.style.left = `${Math.round(Math.max(4, Math.min(x, vw - w - 4)))}px`;
    n.style.top = `${Math.round(Math.max(4, Math.min(anchor.y - h / 2, vh - h - 4)))}px`;
    n.style.visibility = 'visible';
  });
  if (!cursor) return null;
  const { grid, rowPrices, time, colMs } = cursor;
  const before = dur(cursor.msBeforeLatest);
  const colMin = Math.round(colMs / 60000);
  const up = cursor.changePct >= 0;
  return (
    <div
      ref={node}
      id={id}
      role="tooltip"
      style={anchor ? { left: 0, top: 0, visibility: 'hidden' } : undefined}
      className={`${anchor ? 'fixed' : ''} z-40 w-80 max-w-[calc(100vw-8px)] rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-xs tabular-nums text-slate-300 shadow-xl pointer-events-none`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-slate-100">{dayTime(time)}</span>
        <span className="flex items-center gap-1.5">
          <span className={up ? 'text-emerald-400' : 'text-rose-400'}>Close {fmtPrice(cursor.close)}{cursor.changePct != null && ` ${fmtPct(cursor.changePct)}`}</span>
          {touch && onClose && <button type="button" aria-label="Close cell details" onClick={(e) => { e.stopPropagation(); onClose(); }} className="focus-ring pointer-events-auto -my-1 -mr-1 rounded px-2 py-1 text-slate-300 hover:text-white">✕</button>}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-slate-400">{before ? `${before} before the latest` : 'Latest column'} · {colMin} min per column · Price step {fmtPrice(cursor.priceStep)}</p>
      <div className="mt-2 grid grid-cols-[repeat(5,minmax(0,1fr))_auto] gap-x-1 gap-y-0.5" role="presentation">
        {[-2, -1, 0, 1, 2].map((dc) => <span key={dc} className={`text-center text-[10px] ${dc === 0 ? 'font-semibold text-slate-100' : 'text-slate-500'}`}>{hhmm(time + dc * colMs)}</span>)}
        <span />
        {grid.map((row, i) => (
          <React.Fragment key={i}>
            {row.map((v, j) => {
              const t = v > 0 ? scaleT(v, bottom, top) : 0;
              const centre = i === 3 && j === 2;
              return (
                <span
                  key={j}
                  data-cell={centre ? 'cursor' : undefined}
                  className={`truncate rounded px-0.5 py-0.5 text-center text-[10px] ${v == null ? 'text-slate-600' : t > 0.6 ? 'text-slate-950' : 'text-slate-100'} ${centre ? 'ring-2 ring-white' : ''}`}
                  style={{ background: v > 0 ? heatCss(t, palette) : 'rgb(30,41,59)' }}
                >
                  {v == null ? '' : v > 0 ? fmtUsd(v) : '·'}
                </span>
              );
            })}
            <span className={`pl-1 text-[10px] ${i === 3 ? 'rounded bg-slate-100 px-1 font-semibold text-slate-950' : 'text-slate-400'}`}>{rowPrices[i] == null ? '' : fmtPrice(rowPrices[i])}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px]">
        <span className="text-slate-400">±3 rows: shorts · longs</span>
        <span><span className="text-rose-400">{usd(cursor.rowShorts)}</span> · <span className="text-emerald-400">{usd(cursor.rowLongs)}</span></span>
      </div>
      <dl className="mt-2 space-y-0.5 border-t border-slate-800 pt-2 text-[11px]">
        <div className="flex justify-between"><dt>Est. liquidations in this cell</dt><dd className="text-slate-100">{usd(cursor.leverage)}</dd></div>
        <div className="flex justify-between"><dt className="text-emerald-400">Longs</dt><dd className="text-slate-100">{usd(cursor.longs)}</dd></div>
        <div className="flex justify-between"><dt className="text-rose-400">Shorts</dt><dd className="text-slate-100">{usd(cursor.shorts)}</dd></div>
        <div className="flex justify-between"><dt>From price</dt><dd className="text-slate-100">{fmtPct(cursor.fromPricePct)}</dd></div>
        <div className="flex justify-between"><dt>Swept from the close to here</dt><dd className="text-slate-100">{usd(cursor.swept)}</dd></div>
      </dl>
      <p className="mt-1.5 text-[10px] text-slate-500">Model estimates in USD, not exchange data.</p>
    </div>
  );
};

export default HeatHoverCard;
