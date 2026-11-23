import React, { useCallback, useMemo, useState } from 'react';
import usePolling from '../../lib/usePolling';
import useCanvas from './useCanvas';
import { LoadingBlock } from '../ui/Skeleton';
import { BYBIT_NOTE, FUT, Notice, Panel, coin, fmtPrice, fmtUsd, is404 } from './shared';

const H = 300;
const PAD = { l: 8, r: 56, t: 8, b: 20 };

// Shorts get liquidated above price, longs below. Cumulative runs outward from the current price.
export function prepare(levels, price) {
  const up = levels.filter((l) => l.price >= price && l.shortUsd > 0).map((l) => ({ price: l.price, usd: l.shortUsd }));
  const down = levels.filter((l) => l.price < price && l.longUsd > 0).map((l) => ({ price: l.price, usd: l.longUsd })).reverse();
  let a = 0;
  let b = 0;
  return {
    up: up.map((l) => ({ ...l, cum: (a += l.usd) })),
    down: down.map((l) => ({ ...l, cum: (b += l.usd) })),
  };
}

const LiqMap = ({ symbol }) => {
  const { data, error, loading, source } = usePolling(`${FUT}/liqmap/${symbol}`, 60000);
  const [hover, setHover] = useState(null);
  const ok = data && data.symbol === symbol && Array.isArray(data.levels) && data.levels.length > 0;
  const m = useMemo(() => (ok ? prepare(data.levels, data.price) : null), [ok, data]);

  const geo = useMemo(() => {
    if (!ok) return null;
    const lo = data.levels[0].price;
    const hi = data.levels[data.levels.length - 1].price;
    const step = data.levels.length > 1 ? (hi - lo) / (data.levels.length - 1) : (hi || 1) * 0.001;
    const maxBar = Math.max(...m.up.map((l) => l.usd), ...m.down.map((l) => l.usd), 1);
    const maxCum = Math.max(m.up.length ? m.up[m.up.length - 1].cum : 0, m.down.length ? m.down[m.down.length - 1].cum : 0, 1);
    return { lo: lo - step / 2, hi: hi + step / 2, step, maxBar, maxCum };
  }, [ok, data, m]);

  const draw = useCallback((ctx, W, Ht) => {
    if (!geo) return;
    const pw = W - PAD.l - PAD.r;
    const ph = Ht - PAD.t - PAD.b;
    const X = (p) => PAD.l + ((p - geo.lo) / (geo.hi - geo.lo)) * pw;
    const bw = Math.max(1, (geo.step / (geo.hi - geo.lo)) * pw - 1);
    const base = PAD.t + ph;
    ctx.clearRect(0, 0, W, Ht);
    const bars = (list, color) => {
      ctx.fillStyle = color;
      list.forEach((l) => { const h = (l.usd / geo.maxBar) * ph * 0.6; ctx.fillRect(X(l.price) - bw / 2, base - h, bw, h); });
    };
    bars(m.up, 'rgba(251, 113, 133, 0.75)');
    bars(m.down, 'rgba(52, 211, 153, 0.75)');
    const line = (list, color) => {
      if (!list.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      list.forEach((l, i) => { const y = base - (l.cum / geo.maxCum) * ph; if (i) ctx.lineTo(X(l.price), y); else ctx.moveTo(X(l.price), y); });
      ctx.stroke();
    };
    line(m.up, '#fb7185');
    line(m.down, '#34d399');
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText(fmtUsd(geo.maxCum), PAD.l + pw + 4, PAD.t + 8);
    ctx.fillText('cum.', PAD.l + pw + 4, PAD.t + 20);
    ctx.fillText('$0', PAD.l + pw + 4, base);
    for (let i = 0; i <= 4; i += 1) {
      const p = geo.lo + ((geo.hi - geo.lo) * i) / 4;
      ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      ctx.fillText(fmtPrice(p), X(p), Ht - 5);
    }
    ctx.strokeStyle = '#22d3ee';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(X(data.price), PAD.t);
    ctx.lineTo(X(data.price), base);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#22d3ee';
    ctx.textAlign = X(data.price) > pw / 2 ? 'right' : 'left';
    ctx.fillText(`Price ${fmtPrice(data.price)}`, X(data.price) + (X(data.price) > pw / 2 ? -4 : 4), PAD.t + 10);
  }, [geo, m, data]);

  const { wrap, canvas } = useCanvas(draw, H);

  const onMove = (e) => {
    if (!geo) return;
    const b = canvas.current.getBoundingClientRect();
    const pw = b.width - PAD.l - PAD.r;
    const p = geo.lo + (((e.clientX - b.left - PAD.l) / pw) * (geo.hi - geo.lo));
    const near = data.levels.reduce((best, l) => (Math.abs(l.price - p) < Math.abs(best.price - p) ? l : best));
    setHover({ level: near, x: e.clientX - b.left, w: b.width });
  };

  const totalShort = ok ? m.up.reduce((s, l) => s + l.usd, 0) : 0;
  const totalLong = ok ? m.down.reduce((s, l) => s + l.usd, 0) : 0;
  const label = ok ? `${coin(symbol)} estimated liquidation map: ${fmtUsd(totalShort)} short liquidations above ${fmtPrice(data.price)}, ${fmtUsd(totalLong)} long liquidations below` : '';

  return (
    <Panel title={`Estimated liquidation map - ${coin(symbol)}`} right={<span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[11px] text-amber-400">Estimated model</span>}>
      <p className="mb-2 text-xs text-amber-400">Estimated model: exchanges do not publish liquidation prices.</p>
      {source === 'bybit' && <p className="mb-2 text-xs text-amber-400">{BYBIT_NOTE}</p>}
      {!ok ? (
        loading ? <LoadingBlock height={H} /> : <Notice tone={error ? 'error' : 'muted'}>{is404(error) ? 'No perpetual market for this symbol.' : error ? 'Liquidation map unavailable for this symbol right now.' : 'No estimate available.'}</Notice>
      ) : (
        <>
          <div ref={wrap} className="relative">
            <canvas ref={canvas} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block" />
            {hover && (
              <div className="pointer-events-none absolute top-6 z-10 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs tabular-nums text-slate-200" style={{ left: Math.min(hover.x + 12, hover.w - 170) }}>
                <div>{fmtPrice(hover.level.price)}</div>
                <div className="text-rose-400">Est. shorts liquidated {fmtUsd(hover.level.shortUsd)}</div>
                <div className="text-emerald-400">Est. longs liquidated {fmtUsd(hover.level.longUsd)}</div>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span><i className="mr-1 inline-block h-2 w-2 bg-rose-400" />Shorts above price (bars) with cumulative line: {fmtUsd(totalShort)}</span>
            <span><i className="mr-1 inline-block h-2 w-2 bg-emerald-400" />Longs below price: {fmtUsd(totalLong)}</span>
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
