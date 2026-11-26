// Pure zoom/pan maths shared by the liquidation map, the heatmap and their tests.
// A view is {k, ox, oy}: zoom factor (1 = whole range) and the offsets of the visible window, as fractions of the FULL
// range measured from the left / top edge. The window is 1/k wide, so ox in [0, 1 - 1/k]. axes 'x' keeps oy at 0.
export const MIN_K = 1;
export const MAX_K = 20;
export const STEP = 1.5; // one +/- button or key press
export const FULL = { k: 1, ox: 0, oy: 0 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function clampView(v, axes = 'xy') {
  const k = clamp(Number.isFinite(v.k) ? v.k : 1, MIN_K, MAX_K);
  const room = 1 - 1 / k;
  return { k, ox: clamp(v.ox || 0, 0, room), oy: axes === 'x' ? 0 : clamp(v.oy || 0, 0, room) };
}

// Zoom by `factor`, keeping the full-range position under the pointer (fx, fy = fractions of the visible plot) fixed.
export function zoomAt(v, factor, fx = 0.5, fy = 0.5, axes = 'xy') {
  const k = clamp(v.k * factor, MIN_K, MAX_K);
  return clampView({ k, ox: v.ox + fx / v.k - fx / k, oy: v.oy + fy / v.k - fy / k }, axes);
}

// Drag by dfx / dfy (fractions of the visible plot; positive = content moves right / down).
export const panBy = (v, dfx, dfy, axes = 'xy') => clampView({ ...v, ox: v.ox - dfx / v.k, oy: v.oy - dfy / v.k }, axes);

// Visible-plot fraction <-> full-range fraction, per axis (o = ox or oy).
export const toFull = (v, o, f) => o + f / v.k;
export const toView = (v, o, full) => (full - o) * v.k;

// Shift the window the least amount that brings the full-range point (x, y) into view.
export function reveal(v, x, y, axes = 'xy') {
  const fix = (o, p) => (p < o ? p : p > o + 1 / v.k ? p - 1 / v.k : o);
  return clampView({ ...v, ox: fix(v.ox, x), oy: fix(v.oy, y) }, axes);
}

export const fmtZoom = (k) => `${+k.toFixed(k < 10 ? 1 : 0)}x`;
