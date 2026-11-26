// Pure helpers for the Order Book Heatmap redesign: layout constants, option lists, stat-card and label formatting, unit scaling.
import { fmtMarketPrice, fmtPct, fmtQty, fmtUsd } from '../ui/fmt';

export const PAD = { l: 8, r: 74, t: 8, b: 22 };
export const SUB_H = 46; // height of the volume sub pane
export const INTERVALS = [{ id: '1m', ms: 60e3 }, { id: '5m', ms: 300e3 }, { id: '15m', ms: 900e3 }];
export const GRIDS = [1, 2, 5, 10, 20];
export const BANDS = [0.5, 1, 2, 5];
export const UNITS = [{ id: 'usd', label: 'Value' }, { id: 'qty', label: 'Size' }];
export const SUBPANES = [{ id: 'none', label: 'None' }, { id: 'volume', label: 'Candle volume' }];
export const LAYERS = [
  { id: 'candles', label: 'Candles' },
  { id: 'line', label: 'Price line' },
  { id: 'walls', label: 'Wall labels' },
  { id: 'trades', label: 'Trade bubbles' },
];
export const DEFAULT_LAYERS = { candles: true, line: true, walls: true, trades: true };
export const validLayers = (v) => !!v && typeof v === 'object' && LAYERS.every((l) => typeof v[l.id] === 'boolean');

// "2m", "1h 5m", "<1m": how long a wall has stood.
export function fmtDur(ms) {
  const m = Math.floor((ms || 0) / 60e3);
  if (m < 1) return '<1m';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}

// Imbalance is (bid - ask) / (bid + ask) of resting USD inside the band; within +-1% reads as balanced.
export function imbalanceLabel(pct) {
  if (!Number.isFinite(pct)) return { text: '--', tone: 'text-slate-400' };
  if (Math.abs(pct) < 1) return { text: 'balanced', tone: 'text-slate-300' };
  return pct > 0 ? { text: 'bids heavier', tone: 'text-emerald-400' } : { text: 'asks heavier', tone: 'text-orange-400' };
}

// What band the depth numbers really cover: the snapshot may not reach the requested percent.
export const bandText = (depth) => (depth.partial ? `within ${depth.bandPct}% (all the snapshot reaches)` : `within ${depth.requestedPct}%`);

export const distText = (distPct) => `${fmtPct(distPct)} from price`;

// Six stat cards from one heatmap response. Pure so the formatting is testable without a DOM.
export function statCards(d, coinName = '') {
  const { book, depth, imbalance: im, walls } = d;
  const wall = (w, none) => (w
    ? { value: fmtMarketPrice(w.price), sub: fmtUsd(w.usd), foot: `${distText(w.distPct)} · up ${fmtDur(w.upForMs)}` }
    : { value: '--', sub: none, foot: '' });
  const none = `None at ${walls.thresholdMult}x the median level`;
  const prev = im.prevPct == null ? 'No 5 min history yet' : `${Math.round(im.prevAgoMs / 60e3)} min ago ${fmtPct(im.prevPct, 1)}`;
  return [
    { id: 'last', label: 'Last price', value: fmtMarketPrice(d.lastPrice), sub: `Bid ${fmtMarketPrice(book.bestBid)} · Ask ${fmtMarketPrice(book.bestAsk)}`, tone: 'text-slate-100' },
    { id: 'bid', label: `Bid depth ${bandText(depth)}`, value: fmtUsd(depth.bidUsd), sub: `${fmtQty(depth.bidQty)} ${coinName}`.trim(), tone: 'text-emerald-400' },
    { id: 'ask', label: `Ask depth ${bandText(depth)}`, value: fmtUsd(depth.askUsd), sub: `${fmtQty(depth.askQty)} ${coinName}`.trim(), tone: 'text-orange-400' },
    { id: 'imb', label: `Imbalance ±${depth.bandPct}%`, value: fmtPct(im.pct, 1), sub: imbalanceLabel(im.pct).text, foot: prev, tone: imbalanceLabel(im.pct).tone },
    { id: 'bidwall', label: 'Largest bid wall', ...wall(walls.largestBid, none), tone: 'text-emerald-400' },
    { id: 'askwall', label: 'Largest ask wall', ...wall(walls.largestAsk, none), tone: 'text-orange-400' },
  ];
}

// Cell values in the chosen unit. Cells are USD; size = USD / the row's price. max = the 99th percentile like the server's.
export function scaleCells(d, unit) {
  if (unit !== 'qty') return { cells: d.cells, max: d.max };
  const cells = d.cells.map((v, i) => (v > 0 ? v / (d.priceMin + ((i % d.rows) + 0.5) * d.priceStep) : 0));
  const nz = cells.filter((v) => v > 0).sort((a, b) => a - b);
  return { cells, max: nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * 0.99))] : 0 };
}
export const fmtUnit = (v, unit) => (unit === 'qty' ? fmtQty(v) : fmtUsd(v));

// Words for the wall event log.
export const OUTCOME = { appeared: 'Appeared', pulled: 'Pulled', filled: 'Filled' };

// Status pill: what the data is doing right now.
export function liveStatus(data, error) {
  if (!data) return error ? { text: 'Offline', cls: 'border-rose-500/40 text-rose-300' } : { text: 'Loading', cls: 'border-slate-600 text-slate-300' };
  if (data.status === 'ok' && !data.stale && !error) return { text: 'Live', cls: 'border-emerald-500/40 text-emerald-300', dot: 'bg-emerald-400' };
  if (data.status === 'stale' || data.stale || error) return { text: 'Stale', cls: 'border-amber-500/40 text-amber-300', dot: 'bg-amber-400' };
  if (data.status === 'thin') return { text: 'Thin book', cls: 'border-amber-500/40 text-amber-300' };
  return { text: 'Collecting', cls: 'border-slate-600 text-slate-300', dot: 'bg-slate-400' };
}
