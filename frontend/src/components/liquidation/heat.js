// Pure helpers for the predicted-liquidation heatmap.

// "Spectral heat": the public viridis scale sampled at 9 stops, dark purple -> blue -> teal -> green -> yellow.
const STOPS = [[68, 1, 84], [71, 45, 123], [59, 82, 139], [44, 114, 142], [33, 145, 140], [40, 174, 128], [94, 201, 98], [173, 220, 48], [253, 231, 37]];

// t in [0,1] (clamped) -> [r, g, b]
export function heatColor(t) {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
}
export const heatCss = (t) => `rgb(${heatColor(t).join(',')})`;

// Linear position of a cell value between the sliders' bottom and top (0..1, clamped); 1 when the range is empty.
export const scaleT = (v, bottom, top) => (top > bottom ? Math.min(1, Math.max(0, (v - bottom) / (top - bottom))) : 1);

// Cell under a pointer. fx/fy are fractions of the plot area (fy = 0 at the top, price rows grow upward).
export function cellAt(d, fx, fy) {
  if (!d || !d.cols || !d.rows || fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
  const col = Math.floor(fx * d.cols);
  const row = d.rows - 1 - Math.floor(fy * d.rows);
  return {
    col, row, time: d.t0 + col * d.colMs, priceLo: d.priceMin + row * d.priceStep, priceHi: d.priceMin + (row + 1) * d.priceStep, usd: d.cells[col * d.rows + row] || 0,
  };
}

// Round-number axis ticks inside [lo, hi], roughly `n` of them.
export function niceTicks(lo, hi, n = 6) {
  const raw = (hi - lo) / n;
  if (!(raw > 0)) return [];
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toPrecision(12));
  return out;
}

const TICK_MS = [5, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * 60e3);
// Local-time axis ticks over [t0, t1] with at least `minGap` px between them: [{t, x (0..1)}].
export function timeTicks(t0, t1, width, minGap = 70, tzOffsetMs = -new Date(t0).getTimezoneOffset() * 60e3) {
  if (!(t1 > t0) || !(width > 0)) return [];
  const iv = TICK_MS.find((m) => (m / (t1 - t0)) * width >= minGap) || TICK_MS[TICK_MS.length - 1];
  const out = [];
  for (let t = Math.ceil((t0 + tzOffsetMs) / iv) * iv - tzOffsetMs; t <= t1; t += iv) out.push({ t, x: (t - t0) / (t1 - t0) });
  return out;
}
