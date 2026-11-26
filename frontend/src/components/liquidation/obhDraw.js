// Canvas painter for the order book heatmap: heat cells, candles, price line, wall tags, trade bubbles, axes, last-price tag.
// All geometry goes through two maps from full-range fractions to pixels so zoom/pan (view = {k, ox, oy}) is one transform.
import { heatColor, niceTicks, scaleT, timeTicks } from './heat';
import { PAD, SUB_H, fmtUnit } from './obh';
import { fmtMarketPrice, fmtTime, fmtUsd } from './shared';

const UP = '#34d399';
const DOWN = '#fb7185';
const ASK = '#fb923c';
const TAG_H = 16;
const FONT = '10px ui-sans-serif, system-ui';

const tag = (ctx, text, x, y, { fill, stroke, color, right = true }) => {
  ctx.font = FONT;
  const w = (ctx.measureText(text)?.width ?? text.length * 6) + 8;
  const x0 = right ? x - w : x;
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x0, y - TAG_H / 2, w, TAG_H); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y - TAG_H / 2 + 0.5, w - 1, TAG_H - 1); }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(text, x0 + 4, y + 3.5);
};

// p: { d, cells, max (in the unit of cells), palette, range: [lo, hi] percent of max, view, layers, candles, ivMs, sub: 'none' | 'volume' }
export function drawObh(ctx, W, Ht, p) {
  const { d, cells, max, palette, view, layers, candles, ivMs } = p;
  const subH = p.sub === 'volume' ? SUB_H : 0;
  const pw = W - PAD.l - PAD.r;
  const ph = Ht - PAD.t - PAD.b - subH;
  const spanT = d.cols * d.colMs;
  const spanP = d.priceStep * d.rows;
  const X = (t) => PAD.l + (((t - d.t0) / spanT - view.ox) * view.k) * pw;
  const Y = (price) => PAD.t + (((1 - (price - d.priceMin) / spanP) - view.oy) * view.k) * ph;
  const bottom = (max * p.range[0]) / 100;
  const top = (max * p.range[1]) / 100;
  ctx.clearRect(0, 0, W, Ht);
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.l, PAD.t, pw, ph);
  ctx.clip();

  const gap = new Set(d.gaps);
  const cw = (pw / d.cols) * view.k;
  const rh = (ph / d.rows) * view.k;
  for (let c = 0; c < d.cols; c += 1) {
    const x = PAD.l + ((c / d.cols - view.ox) * view.k) * pw;
    if (gap.has(c) || x + cw < PAD.l || x > PAD.l + pw) continue;
    for (let r = 0; r < d.rows; r += 1) {
      const v = cells[c * d.rows + r];
      if (!(v > 0) || v < bottom) continue;
      const y = PAD.t + (((d.rows - 1 - r) / d.rows - view.oy) * view.k) * ph;
      if (y + rh < PAD.t || y > PAD.t + ph) continue;
      const [R, G, B] = heatColor(scaleT(v, bottom, top), palette);
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(x, y, Math.ceil(cw), Math.ceil(rh));
    }
  }

  if (layers.line) { // grey price path (the mid of each column) and the dotted last-price line
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let pen = false;
    d.mids.forEach((m, c) => {
      if (m == null) { pen = false; return; }
      const x = X(d.t0 + (c + 0.5) * d.colMs);
      if (pen) ctx.lineTo(x, Y(m)); else ctx.moveTo(x, Y(m));
      pen = true;
    });
    ctx.stroke();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.l, Y(d.lastPrice));
    ctx.lineTo(PAD.l + pw, Y(d.lastPrice));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (layers.candles && candles?.length && ivMs) {
    const bw = Math.max(1, Math.min(14, (ivMs / spanT) * pw * view.k * 0.7));
    candles.forEach((k) => {
      const t = k.time * 1000 + ivMs / 2;
      if (t < d.t0 - ivMs || t > d.t0 + spanT + ivMs) return;
      const x = X(t);
      const col = k.close >= k.open ? UP : DOWN;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, Y(k.high));
      ctx.lineTo(x, Y(k.low));
      ctx.stroke();
      const yo = Y(k.open);
      const yc = Y(k.close);
      ctx.fillRect(x - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yo - yc)));
    });
  }

  if (layers.trades) {
    (d.trades || []).forEach((x) => {
      const r = Math.max(2, Math.min(9, Math.sqrt(x.usd) / 40));
      ctx.beginPath();
      ctx.arc(X(x.t), Y(x.price), r, 0, Math.PI * 2);
      ctx.fillStyle = x.side === 'buy' ? 'rgba(52,211,153,0.35)' : 'rgba(251,146,60,0.35)';
      ctx.fill();
      ctx.strokeStyle = x.side === 'buy' ? UP : ASK;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }
  ctx.restore();

  const right = PAD.l + pw;
  const placed = [Y(d.lastPrice)]; // tag rows already taken, so tags never sit on each other
  const clash = (v) => placed.some((q) => Math.abs(q - v) < TAG_H);
  const free = (y) => { let yy = y; while (clash(yy)) yy += TAG_H; placed.push(yy); return yy; };
  if (layers.walls) {
    [[d.walls.largestAsk, 'Ask wall', ASK], [d.walls.largestBid, 'Bid wall', UP]].forEach(([w, name, col]) => {
      if (!w) return;
      const y = Y(w.price);
      if (y < PAD.t || y > PAD.t + ph) return;
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(PAD.l, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      tag(ctx, `${name} ${fmtUsd(w.usd)}`, right - 4, free(y), { fill: 'rgba(2,6,23,0.85)', stroke: col, color: col });
    });
  }

  // axes: price on the right, time at the bottom, last-price tag in the gutter
  ctx.font = FONT;
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'left';
  const pLo = d.priceMin + (spanP * (1 - (view.oy + 1 / view.k)));
  const pHi = d.priceMin + (spanP * (1 - view.oy));
  niceTicks(pLo, pHi, 6).forEach((v) => { const y = Y(v); if (y > PAD.t + 6 && y < PAD.t + ph - 4) ctx.fillText(fmtMarketPrice(v), right + 4, y + 3); });
  ctx.textAlign = 'center';
  const t0v = d.t0 + view.ox * spanT;
  timeTicks(t0v, t0v + spanT / view.k, pw, 70).forEach((k) => ctx.fillText(fmtTime(k.t).replace(/:\d\d(?!\d)/, ''), PAD.l + k.x * pw, Ht - 6));
  const yl = Math.max(PAD.t + TAG_H / 2, Math.min(PAD.t + ph - TAG_H / 2, Y(d.lastPrice)));
  tag(ctx, fmtMarketPrice(d.lastPrice), right + 2, yl, { fill: '#22d3ee', color: '#082f49', right: false });

  if (subH) { // candle volume under the heat, same x mapping
    const base = PAD.t + ph + subH - 2;
    ctx.fillStyle = 'rgba(148,163,184,0.12)';
    ctx.fillRect(PAD.l, PAD.t + ph + 2, pw, subH - 2);
    const vmax = Math.max(0, ...(candles || []).map((k) => k.volume || 0));
    if (vmax > 0 && ivMs) {
      const bw = Math.max(1, Math.min(14, (ivMs / spanT) * pw * view.k * 0.7));
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, PAD.t + ph, pw, subH);
      ctx.clip();
      candles.forEach((k) => {
        ctx.fillStyle = k.close >= k.open ? UP : DOWN;
        const h = ((k.volume || 0) / vmax) * (subH - 8);
        ctx.fillRect(X(k.time * 1000 + ivMs / 2) - bw / 2, base - h, bw, h);
      });
      ctx.restore();
    }
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.fillText(vmax > 0 ? `Volume (max ${fmtUnit(vmax, 'qty')})` : 'Volume', PAD.l + 4, PAD.t + ph + 12);
  }
}

// Inverse of the draw maps for the pointer: plot-area fractions (fx, fy; fy 0 = top) in the visible window -> data coordinates.
export function pointAt(d, view, fx, fy) {
  const ft = view.ox + fx / view.k;
  const fp = view.oy + fy / view.k;
  const t = d.t0 + ft * d.cols * d.colMs;
  const price = d.priceMin + (1 - fp) * d.priceStep * d.rows;
  const col = Math.min(d.cols - 1, Math.max(0, Math.floor(ft * d.cols)));
  const row = Math.min(d.rows - 1, Math.max(0, Math.floor((1 - fp) * d.rows)));
  return { t, price, col, row, usd: d.cells[col * d.rows + row] || 0, inside: ft >= 0 && ft < 1 && fp >= 0 && fp < 1 };
}
