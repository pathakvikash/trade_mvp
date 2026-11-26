import React, { useCallback, useMemo, useRef, useState } from 'react';
import usePolling from '../../lib/usePolling';
import useCanvas from './useCanvas';
import { LoadingBlock } from '../ui/Skeleton';
import useZoomPan from './useZoomPan';
import ZoomControls from './ZoomControls';
import { niceTicks } from './heat';
import { MAX_K, clampView, toFull, toView } from './zoomView';
import { LONG_SHADES, SHORT_SHADES, buildMap, distPct, liqStats, tiersOf, viewForRange } from './liqMapCalc';
import { PARTIAL_NOTE, sourceNote, FUT, Notice, StaleNote, Panel, coin, fmtMarketPrice, fmtPrice, fmtUsd, is404 } from './shared';

const H = 300;
const PAD = { l: 44, r: 52, t: 16, b: 20 };
const RANGES = [{ label: '±2%', pct: 0.02 }, { label: '±5%', pct: 0.05 }, { label: '±10%', pct: 0.1 }, { label: 'All', pct: null }];
const shade = (list, i, n) => list[n === 1 ? 1 : i];
const chip = 'focus-ring inline-flex min-h-[44px] items-center rounded-md border px-2 text-xs sm:min-h-0 sm:py-0.5';

// Range brush under the chart: a miniature of the whole span with the visible window on it. Drag the window to pan, drag an
// edge to resize (= zoom), arrow keys on an edge. It reads and writes the same zoom view as the chart, so both stay in sync.
const Brush = ({ map, price, view, onView }) => {
  const track = useRef(null);
  const drag = useRef(null);
  const l = view.ox;
  const r = view.ox + 1 / view.k;
  const minW = 1 / MAX_K;
  const fx = (e) => { const b = track.current.getBoundingClientRect(); return b.width > 0 ? (e.clientX - b.left) / b.width : 0; };
  const apply = (mode, x, start) => {
    if (mode === 'move') onView(clampView({ k: view.k, ox: start.ox + (x - start.x) }, 'x'));
    else if (mode === 'l') { const nl = Math.max(0, Math.min(x, r - minW)); onView(clampView({ k: 1 / (r - nl), ox: nl }, 'x')); }
    else { const nr = Math.min(1, Math.max(x, l + minW)); onView(clampView({ k: 1 / (nr - l), ox: l }, 'x')); }
  };
  const down = (mode) => (e) => {
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
    drag.current = { mode, start: { x: fx(e), ox: l } };
  };
  const move = (e) => { if (drag.current) apply(drag.current.mode, fx(e), drag.current.start); };
  const end = () => { drag.current = null; };
  const keyEdge = (mode) => (e) => {
    const d = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
    if (!d) return;
    e.preventDefault();
    apply(mode, (mode === 'l' ? l : r) + d, { x: 0, ox: l });
  };
  const n = map.rows.length || 1;
  const top = Math.max(map.maxBar, 1);
  const lo = map.rows[0]?.price ?? 0;
  const hi = map.rows[n - 1]?.price ?? 1;
  const pp = hi > lo ? ((price - lo) / (hi - lo)) * 100 : 50;
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const edge = (mode, pos, label) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos * 100)}
      aria-valuetext={`${fmtPrice(lo + pos * (hi - lo))}`}
      data-testid={`brush-${mode}`}
      onPointerDown={down(mode)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={keyEdge(mode)}
      style={{ left: pct(pos), touchAction: 'none' }}
      className="focus-ring absolute top-0 flex h-full w-11 -translate-x-1/2 cursor-ew-resize justify-center"
    >
      <span className="h-full w-1 rounded bg-cyan-400" />
    </div>
  );
  return (
    <div className="mt-2" style={{ paddingLeft: PAD.l, paddingRight: PAD.r }}>
      <div ref={track} data-testid="brush" className="relative h-12 select-none rounded border border-slate-800 bg-slate-900/60">
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
          {map.rows.map((row, i) => {
            const h = ((row.longUsd + row.shortUsd) / top) * 90;
            return <rect key={row.price} x={i} y={100 - h} width={0.9} height={h} fill={row.price < price ? '#fb7185' : '#34d399'} opacity="0.6" />;
          })}
        </svg>
        <span className="absolute top-0 h-full border-l border-dashed border-cyan-400/70" style={{ left: `${pp}%` }} />
        <div className="absolute top-0 h-full bg-cyan-400/15" style={{ left: pct(l), width: pct(r - l), touchAction: 'none', cursor: view.k > 1 ? 'grab' : 'default' }} onPointerDown={down('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} data-testid="brush-window" />
        {edge('l', l, 'Range start')}
        {edge('r', r, 'Range end')}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Showing {fmtMarketPrice(lo + l * (hi - lo))} to {fmtMarketPrice(lo + r * (hi - lo))}. Drag the window or its edges.</p>
    </div>
  );
};

const Stat = ({ label, value, sub, tone }) => (
  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-2">
    <div className="truncate text-[11px] text-slate-400">{label}</div>
    <div className={`truncate text-sm font-semibold tabular-nums ${tone || 'text-slate-200'}`}>{value}</div>
    {sub && <div className="truncate text-[11px] tabular-nums text-slate-500">{sub}</div>}
  </div>
);

const pctTxt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

const LiqMap = ({ symbol }) => {
  const [rk, setRk] = useState(0);
  const { data, error, loading, source, fetching } = usePolling(`${FUT}/liqmap/${symbol}`, 60000, rk);
  const [hover, setHover] = useState(null);
  const [off, setOff] = useState({});
  const ok = data && data.symbol === symbol && Array.isArray(data.levels) && data.levels.length > 0;
  const tiers = useMemo(() => tiersOf(data), [data]);
  const on = useMemo(() => Object.fromEntries(tiers.map((t) => [t.id, !off[t.id]])), [tiers, off]);
  const m = useMemo(() => (ok ? buildMap(data.levels, data.price, tiers, on) : null), [ok, data, tiers, on]);
  const stats = useMemo(() => (ok ? liqStats(m, data.price) : null), [ok, m, data]);

  const geo = useMemo(() => {
    if (!ok) return null;
    const lo = data.levels[0].price;
    const hi = data.levels[data.levels.length - 1].price;
    const step = data.levels.length > 1 ? (hi - lo) / (data.levels.length - 1) : (hi || 1) * 0.001;
    return { lo: lo - step / 2, hi: hi + step / 2, step };
  }, [ok, data]);

  // Zoom is on the price (x) axis only. The vertical scales (bars, cumulative lines) stay global on purpose:
  // the cumulative lines start at the current price, so rescaling them to the visible window would misstate them.
  const wrap0 = useRef(null);
  const zoom = useZoomPan(wrap0, { axes: 'x', pad: PAD, resetKey: symbol, enabled: ok });
  const { view } = zoom;

  const draw = useCallback((ctx, W, Ht) => {
    if (!geo) return;
    const pw = W - PAD.l - PAD.r;
    const ph = Ht - PAD.t - PAD.b;
    const full = geo.hi - geo.lo;
    const X = (p) => PAD.l + toView(view, view.ox, (p - geo.lo) / full) * pw;
    const bw = Math.max(1, (geo.step / full) * pw * view.k - 1);
    const base = PAD.t + ph;
    ctx.clearRect(0, 0, W, Ht);
    ctx.font = '10px ui-sans-serif, system-ui';
    // grid + both $ axes (left: bar height per bucket, right: cumulative lines)
    ctx.fillStyle = '#94a3b8';
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    niceTicks(0, m.maxBar, 4).forEach((v) => {
      const y = base - (v / m.maxBar) * ph;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.fillText(fmtUsd(v), PAD.l - 4, y + 3);
    });
    ctx.textAlign = 'left';
    niceTicks(0, m.maxCum, 4).forEach((v) => ctx.fillText(fmtUsd(v), PAD.l + pw + 4, base - (v / m.maxCum) * ph + 3));
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, 0, pw, Ht);
    ctx.clip();
    m.rows.forEach((row) => {
      const parts = row.price < data.price ? row.long : row.short;
      const list = row.price < data.price ? LONG_SHADES : SHORT_SHADES;
      let y = base;
      parts.forEach((v, i) => {
        if (v <= 0) return;
        const h = (v / m.maxBar) * ph;
        ctx.fillStyle = shade(list, i, tiers.length);
        ctx.fillRect(X(row.price) - bw / 2, y - h, bw, h);
        y -= h;
      });
    });
    const line = (pts, color) => {
      if (pts.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      pts.forEach(([p, v], i) => { const y = base - (v / m.maxCum) * ph; if (i) ctx.lineTo(X(p), y); else ctx.moveTo(X(p), y); });
      ctx.stroke();
    };
    line([...m.rows.filter((r) => r.price < data.price).map((r) => [r.price, r.cumLong]), [data.price, 0]], '#fb7185');
    line([[data.price, 0], ...m.rows.filter((r) => r.price >= data.price).map((r) => [r.price, r.cumShort])], '#34d399');
    if (hover) {
      const hx = X(m.rows[hover.idx].price);
      ctx.strokeStyle = 'rgba(226,232,240,0.5)';
      ctx.beginPath(); ctx.moveTo(hx, PAD.t); ctx.lineTo(hx, base); ctx.stroke();
    }
    ctx.restore();
    // price axis labels for the visible window
    ctx.fillStyle = '#94a3b8';
    const vLo = geo.lo + toFull(view, view.ox, 0) * full;
    const vHi = geo.lo + toFull(view, view.ox, 1) * full;
    ctx.textAlign = 'center';
    niceTicks(vLo, vHi, Math.max(2, Math.floor(pw / 70))).forEach((p) => {
      const x = X(p);
      if (x > PAD.l + 14 && x < PAD.l + pw - 14) ctx.fillText(fmtMarketPrice(p), x, Ht - 5);
    });
    // current price: dashed line while in view, with a label tag; else a tag pinned to the edge on the side it lies
    const xp = X(data.price);
    const inView = xp >= PAD.l && xp <= PAD.l + pw;
    if (inView) {
      ctx.strokeStyle = '#22d3ee';
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(xp, PAD.t); ctx.lineTo(xp, base); ctx.stroke();
      ctx.setLineDash([]);
    }
    const right = xp > PAD.l + pw / 2;
    const txt = `${!inView && !right ? '← ' : ''}Price ${fmtMarketPrice(data.price)}${!inView && right ? ' →' : ''}`;
    const tw = txt.length * 5.6 + 8; // ~5.6px per char at 10px; no measureText so it also runs on a stubbed canvas
    const tx = inView ? Math.min(Math.max(xp - tw / 2, PAD.l), PAD.l + pw - tw) : right ? PAD.l + pw - tw : PAD.l;
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(tx, 1, tw, 13);
    ctx.fillStyle = '#082f49';
    ctx.textAlign = 'left';
    ctx.fillText(txt, tx + 4, 11);
  }, [geo, m, data, view, tiers, hover]);

  const { wrap, canvas } = useCanvas(draw, H);
  const setWrap = (n) => { wrap.current = n; wrap0.current = n; };

  const onMove = (e) => {
    if (!geo) return;
    if (zoom.handlers.move(e) || zoom.isDragging()) { setHover(null); return; }
    const { fx } = zoom.frac(e.clientX, e.clientY);
    const b = canvas.current.getBoundingClientRect();
    const p = geo.lo + toFull(view, view.ox, fx) * (geo.hi - geo.lo);
    const idx = m.rows.reduce((best, r, i) => (Math.abs(r.price - p) < Math.abs(m.rows[best].price - p) ? i : best), 0);
    setHover({ idx, x: e.clientX - b.left, w: b.width });
  };

  const screenshot = () => {
    try {
      const a = document.createElement('a');
      a.href = canvas.current.toDataURL('image/png');
      a.download = `${coin(symbol)}-liquidation-map.png`;
      a.click();
    } catch { /* canvas unavailable: nothing to save */ }
  };

  const label = ok ? `${coin(symbol)} estimated liquidation map: ${fmtUsd(m.totalShort)} short liquidations above ${fmtPrice(data.price)}, ${fmtUsd(m.totalLong)} long liquidations below` : '';
  const stale = ok && error;
  const hr = hover && m ? m.rows[hover.idx] : null;
  const rangeOn = (pct) => {
    if (!geo) return false;
    const v = viewForRange(pct, data.price, geo.lo, geo.hi);
    return Math.abs(v.k - view.k) < 0.01 && Math.abs(v.ox - view.ox) < 0.005;
  };

  return (
    <Panel id="liq-map" title={`Estimated liquidation map - ${coin(symbol)}`} right={<span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[11px] text-amber-400">Estimated model</span>}>
      <p className="mb-2 text-xs text-amber-400">Estimated model: exchanges do not publish liquidation prices. Levels are inferred from open-interest changes; the realized liquidation feed is only a sample.</p>
      {sourceNote(source, 'heatmap') && <p className="mb-2 text-xs text-amber-400">{sourceNote(source, 'heatmap')}</p>}
      {stale && <StaleNote at={data.generatedAt} />}
      {data?.partial && <p className="mb-2 text-xs text-amber-400">{PARTIAL_NOTE}</p>}
      {!ok ? (
        loading ? <LoadingBlock height={H} /> : <Notice tone={error ? 'error' : 'muted'}>{is404(error) ? 'No perpetual market for this symbol.' : error ? 'Liquidation map unavailable for this symbol right now.' : 'No estimate available.'}</Notice>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="liqmap-header">
            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200">{coin(symbol)}</span>
            <div role="group" aria-label="Price range" className="inline-flex flex-wrap gap-1">
              {RANGES.map((r) => (
                <button key={r.label} type="button" aria-pressed={rangeOn(r.pct)} onClick={() => zoom.setView(viewForRange(r.pct, data.price, geo.lo, geo.hi))} className={`${chip} ${rangeOn(r.pct) ? 'border-cyan-400 text-cyan-300' : 'border-slate-700 text-slate-300 hover:text-slate-100'}`}>{r.label}</button>
              ))}
            </div>
            <ZoomControls k={view.k} onZoom={zoom.zoomBy} onReset={zoom.reset} label="liquidation map" />
            <span data-testid="liqmap-status" className={`rounded-full border px-2 py-0.5 text-[11px] ${stale ? 'border-amber-400/40 text-amber-400' : 'border-emerald-400/40 text-emerald-400'}`}>
              {stale ? 'Stale' : fetching ? 'Updating' : 'Live'} · {new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button type="button" onClick={() => setRk((k) => k + 1)} disabled={!!fetching} className={`${chip} border-slate-700 text-slate-300 hover:text-slate-100 disabled:opacity-50`}>Refresh</button>
            <button type="button" onClick={screenshot} className={`${chip} border-slate-700 text-slate-300 hover:text-slate-100`}>Screenshot</button>
          </div>
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="liqmap-stats">
            <Stat label="Long liq within 2%" value={fmtUsd(stats.longNear)} sub="below price" tone="text-rose-400" />
            <Stat label="Short liq within 2%" value={fmtUsd(stats.shortNear)} sub="above price" tone="text-emerald-400" />
            <Stat label="Biggest cluster" value={stats.cluster ? `${fmtMarketPrice(stats.cluster.price)} · ${fmtUsd(stats.cluster.usd)}` : '--'} sub={stats.cluster ? `${pctTxt(stats.cluster.distPct)} from price (${stats.cluster.side})` : ''} />
            <Stat label="Long vs short total" value={stats.ratio == null ? '--' : `${stats.ratio.toFixed(2)} : 1`} sub={`${fmtUsd(stats.totalLong)} / ${fmtUsd(stats.totalShort)}`} />
          </div>
          <div
            ref={setWrap}
            role="group"
            tabIndex={0}
            aria-label="Liquidation map. Ctrl or Cmd plus wheel, or plus and minus keys, zoom the price axis; drag to pan; 0 or double-click resets."
            onPointerDown={zoom.handlers.down}
            onPointerMove={onMove}
            onPointerUp={zoom.handlers.up}
            onPointerCancel={zoom.handlers.up}
            onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null); }}
            onDoubleClick={zoom.reset}
            onKeyDown={zoom.key}
            style={{ touchAction: 'pan-y' }}
            className="relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          >
            <canvas ref={canvas} role="img" aria-label={label} className="block" />
            {hr && (
              <div data-testid="liqmap-tip" className="pointer-events-none absolute top-6 z-10 min-w-[10rem] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200" style={{ left: Math.max(0, Math.min(hover.x + 12, hover.w - 190)) }}>
                <div className="font-medium">{fmtPrice(hr.price)} <span className="text-slate-400">({pctTxt(distPct(hr.price, data.price))})</span></div>
                {tiers.map((t, i) => (on[t.id] && (hr.long[i] > 0 || hr.short[i] > 0) ? (
                  <div key={t.id} className="flex justify-between gap-3">
                    <span className="text-slate-400">{t.label}</span>
                    <span className={hr.long[i] > 0 ? 'text-rose-400' : 'text-emerald-400'}>{hr.long[i] > 0 ? 'Long' : 'Short'} {fmtUsd(hr.long[i] || hr.short[i])}</span>
                  </div>
                ) : null))}
                <div className="text-rose-400">Cumulative long {fmtUsd(hr.cumLong)}</div>
                <div className="text-emerald-400">Cumulative short {fmtUsd(hr.cumShort)}</div>
              </div>
            )}
          </div>
          <Brush map={m} price={data.price} view={view} onView={zoom.setView} />
          <div role="group" aria-label="Leverage tiers" className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-300">
            {tiers.map((t, i) => (
              <button key={t.id} type="button" aria-pressed={on[t.id]} onClick={() => setOff((o) => ({ ...o, [t.id]: !o[t.id] }))} className={`${chip} gap-1.5 ${on[t.id] ? 'border-slate-600' : 'border-slate-800 text-slate-500 line-through'}`}>
                <i className="inline-block h-2 w-2" style={{ background: shade(LONG_SHADES, i, tiers.length) }} />
                <i className="inline-block h-2 w-2" style={{ background: shade(SHORT_SHADES, i, tiers.length) }} />
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span><i className="mr-1 inline-block h-2 w-2 bg-rose-400" />Longs below price: {fmtUsd(m.totalLong)} (red line: cumulative)</span>
            <span><i className="mr-1 inline-block h-2 w-2 bg-emerald-400" />Shorts above price: {fmtUsd(m.totalShort)} (green line: cumulative)</span>
            <span>Left axis: $ per price bucket. Right axis: cumulative $.</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Method: {data.method || 'n/a'}. Leverage mix 5x–125x, 0.4% maintenance margin. Generated {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
        </>
      )}
    </Panel>
  );
};

export default LiqMap;
