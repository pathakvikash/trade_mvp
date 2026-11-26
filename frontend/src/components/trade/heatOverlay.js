import { heatColor, lensKeeps, scaleT } from '../liquidation/heat';

// Pure helpers for the liquidation heat painted behind the candles. The grid is drawn as ONE bitmap (one pixel per cell)
// scaled onto the chart's axes, so the paint cost does not depend on the number of cells.

// Linear map a -> p through two anchors (a0 -> p0, a1 -> p1); null when an anchor is missing (null coordinate from the chart) or degenerate.
export function linearMap(a0, p0, a1, p1) {
  if (![a0, p0, a1, p1].every(Number.isFinite) || a0 === a1) return null;
  const k = (p1 - p0) / (a1 - a0);
  return (a) => p0 + (a - a0) * k;
}

// Where the grid d (t0, colMs, cols, priceMin, priceStep, rows) lands in a w x h plot. xOf: ms -> px, yOf: price -> px
// (y grows downward). Returns the source rect in bitmap cells and the destination rect in px, both clipped to the plot,
// or null when nothing of the grid is inside (or an axis is degenerate).
export function heatRect(d, xOf, yOf, w, h) {
  if (!d || !xOf || !yOf || !(w > 0) || !(h > 0) || !(d.cols > 0) || !(d.rows > 0)) return null;
  const x0 = xOf(d.t0);
  const x1 = xOf(d.t0 + d.cols * d.colMs);
  const yTop = yOf(d.priceMin + d.rows * d.priceStep);
  const yBot = yOf(d.priceMin);
  if (![x0, x1, yTop, yBot].every(Number.isFinite) || !(x1 > x0) || !(yBot > yTop)) return null;
  const dx = Math.max(0, x0);
  const dx1 = Math.min(w, x1);
  const dy = Math.max(0, yTop);
  const dy1 = Math.min(h, yBot);
  if (dx1 <= dx || dy1 <= dy) return null;
  const kx = d.cols / (x1 - x0);
  const ky = d.rows / (yBot - yTop);
  return { sx: (dx - x0) * kx, sy: (dy - yTop) * ky, sw: (dx1 - dx) * kx, sh: (dy1 - dy) * ky, dx, dy, dw: dx1 - dx, dh: dy1 - dy };
}

// One pixel per cell (row 0 of the data is the bottom row of the image). Zero cells, cells under the intensity floor and
// the other side of the price (long/short lens) stay transparent; alpha grows with intensity so faint levels fade
// and wicks/bodies stay legible. The user's opacity is applied on top at draw time.
export function buildHeatBitmap(d, bottom, top, palette, lens) {
  const c = document.createElement('canvas');
  c.width = d.cols;
  c.height = d.rows;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(d.cols, d.rows);
  for (let col = 0; col < d.cols; col += 1) {
    for (let r = 0; r < d.rows; r += 1) {
      const v = d.cells[col * d.rows + r];
      if (!(v > 0) || v < bottom || !lensKeeps(d, lens, r, col)) continue;
      const t = scaleT(v, bottom, top);
      const [R, G, B] = heatColor(t, palette);
      const o = ((d.rows - 1 - r) * d.cols + col) * 4;
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = Math.round(90 + 165 * t);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
