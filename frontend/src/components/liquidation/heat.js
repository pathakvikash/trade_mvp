// Pure helpers for the predicted-liquidation heatmap.

// Colour scales sampled at 9 stops. "viridis" is the default and the original look (dark purple -> blue -> teal -> green -> yellow).
export const PALETTES = [
  { id: 'viridis', label: 'Viridis (default)', stops: [[68, 1, 84], [71, 45, 123], [59, 82, 139], [44, 114, 142], [33, 145, 140], [40, 174, 128], [94, 201, 98], [173, 220, 48], [253, 231, 37]] },
  { id: 'inferno', label: 'Inferno', stops: [[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]] },
  { id: 'coolwarm', label: 'Cool to warm', stops: [[59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38]] },
];
const stopsOf = (id) => (PALETTES.find((p) => p.id === id) || PALETTES[0]).stops;

// t in [0,1] (clamped) -> [r, g, b]
export function heatColor(t, palette = 'viridis') {
  const STOPS = stopsOf(palette);
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
}
export const heatCss = (t, palette = 'viridis') => `rgb(${heatColor(t, palette).join(',')})`;
export const rampCss = (palette = 'viridis') => `linear-gradient(to right, ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => heatCss(i / 8, palette)).join(',')})`;

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

// A cell as a time and price (column start, bucket middle) and back. Grid indices change meaning when the window moves
// on refresh, so anything kept across a refresh (measure points, a pinned card) is stored as time and price.
export const cellTP = (d, col, row) => ({ t: d.t0 + col * d.colMs, price: d.priceMin + (row + 0.5) * d.priceStep });
export function cellOf(d, t, price) {
  const col = Math.round((t - d.t0) / d.colMs);
  const row = Math.floor((price - d.priceMin) / d.priceStep);
  return col < 0 || col >= d.cols || row < 0 || row >= d.rows ? null : { col, row };
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

// Row holding the current price (clamped into the grid). Cells above it are short liquidations, below it long ones.
export const closeRow = (d, price = d.price) => Math.min(d.rows - 1, Math.max(0, Math.floor((price - d.priceMin) / d.priceStep)));
// Side of a cell: the backend keeps a level open in column c only while candle c has not crossed it, so a cell is a
// short level when it sits above THAT column's close (the last price only for a column without a candle).
const rowSide = (d, row, col) => (d.priceMin + (row + 0.5) * d.priceStep > (d.candles?.[col]?.close ?? d.price) ? 'short' : 'long');
// lens 'heat' keeps every cell; 'long' / 'short' keep only the cells on that side of the column's close.
export const lensKeeps = (d, lens, row, col) => lens === 'heat' || !lens || rowSide(d, row, col) === lens;

// Estimated USD in one column between two rows, both included (the open levels a move between those prices would sweep).
export function sweptBetween(d, col, rowA, rowB) {
  let sum = 0;
  for (let r = Math.min(rowA, rowB); r <= Math.max(rowA, rowB); r += 1) sum += d.cells[col * d.rows + r] || 0;
  return sum;
}

// Everything the hover card shows for the cell at (col,row); a 5 column x 7 row window with the cursor in the middle.
// grid[i][j]: i = 0 is the top row, j = 0 the left column; null outside the data. All values are model estimates.
export function buildCursor(d, col, row) {
  if (!d || col < 0 || col >= d.cols || row < 0 || row >= d.rows) return null;
  const cell = (c, r) => (c >= 0 && c < d.cols && r >= 0 && r < d.rows ? d.cells[c * d.rows + r] || 0 : null);
  const grid = [];
  const rowPrices = [];
  for (let i = 0; i < 7; i += 1) {
    const r = row + 3 - i;
    rowPrices.push(r >= 0 && r < d.rows ? d.priceMin + (r + 0.5) * d.priceStep : null); // bucket middle, like 'From price' and the key levels
    grid.push([-2, -1, 0, 1, 2].map((dc) => cell(col + dc, r)));
  }
  let shorts = 0;
  let longs = 0;
  for (let r = Math.max(0, row - 3); r <= Math.min(d.rows - 1, row + 3); r += 1) {
    if (rowSide(d, r, col) === 'short') shorts += cell(col, r); else longs += cell(col, r);
  }
  const k = d.candles?.[col];
  const close = k?.close ?? d.price; // the hovered column's own close, like the card header
  const usd = cell(col, row);
  const side = rowSide(d, row, col);
  return {
    time: d.t0 + col * d.colMs,
    close,
    changePct: k && k.open ? ((k.close - k.open) / k.open) * 100 : null,
    priceStep: d.priceStep,
    colMs: d.colMs,
    msBeforeLatest: (d.cols - 1 - col) * d.colMs,
    grid,
    rowPrices,
    leverage: usd,
    longs: side === 'long' ? usd : 0,
    shorts: side === 'short' ? usd : 0,
    rowLongs: longs,
    rowShorts: shorts,
    fromPricePct: ((d.priceMin + (row + 0.5) * d.priceStep) / close - 1) * 100,
    swept: sweptBetween(d, col, closeRow(d, close), row),
  };
}
