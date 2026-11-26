import { API } from '../../lib/apiBase';

export const ORDERFLOW = `${API}/api/market/orderflow`;

// "Collecting data, 3 min so far": the collector only knows what it has seen since it started for this symbol.
export const collectingText = (ms) => {
  const m = Math.floor((ms || 0) / 60e3);
  return `Collecting data, ${m < 1 ? 'less than a minute' : `${m} min`} so far`;
};

// What the panel says for a failed or non-ok answer; null when there is data to show.
export function flowNotice(error, data) {
  const st = error?.response?.status;
  const body = error?.response?.data;
  if (st === 404) return 'This coin has no futures market, so there is no order flow to show.';
  if (st === 503 && body?.error === 'collector_busy') return 'Order flow is busy with other coins, try again in a minute.';
  if (error && !data) return 'Order book data is unavailable from this server right now.';
  return null;
}

export const THIN_TEXT = 'Thin book: too few orders or too wide a spread on this coin to draw a useful picture. It will appear when the book fills out.';

export const KLINES = `${API}/api/market/futures/klines`;

// ---- Large Orders helpers (pure, tested in OrderFlow.test.js) ----
export const WALL_MULTS = [5, 10, 20];
export const DEFAULT_MIN = 100e3;

// Pill shown in the header: label + tone. `flow` is the collector payload, `err` its error, `trades` the cvd trades payload.
export function largeStatus(flow, err, trades) {
  if (err?.response?.status === 503 && err.response.data?.error === 'collector_busy' && !flow) return ['Busy', 'amber'];
  if (!flow) return err ? ['Offline', 'amber'] : ['Loading', 'slate'];
  if (flow.stale || flow.status === 'stale') return ['Stale', 'amber'];
  if (flow.status === 'collecting') return ['Collecting', 'cyan'];
  if (flow.status === 'thin') return ['Thin', 'amber'];
  if (flow.status === 'ok') return trades && trades.available === false ? ['Stale', 'amber'] : ['Live', 'emerald'];
  return ['Offline', 'amber'];
}

// A lower threshold chip worth trying when `current` shows nothing: ~10x the median trade, never below the smallest chip.
export function suggestMin(medianUsd, current, chips) {
  const lower = chips.filter((c) => c < current);
  if (!lower.length) return null;
  const target = Math.max(chips[0], (medianUsd || 0) * 10);
  return [...lower].reverse().find((c) => c <= target) ?? lower[0];
}

const sum = (a) => a.reduce((n, x) => n + x.usd, 0);
// Large trades in view: biggest, counts and USD per taker side, buy share of the USD.
export function tradeStats(items) {
  const rows = items || [];
  const buys = rows.filter((t) => t.side === 'buy');
  const sells = rows.filter((t) => t.side === 'sell');
  const buyUsd = sum(buys);
  const sellUsd = sum(sells);
  return { largest: rows.reduce((m, t) => (!m || t.usd > m.usd ? t : m), null), buyN: buys.length, sellN: sells.length, buyUsd, sellUsd, buyShare: buyUsd + sellUsd > 0 ? (buyUsd / (buyUsd + sellUsd)) * 100 : null };
}

// Bid vs ask wall USD within `pct` percent of price; imbalance in -100..100 (positive = more bid wall USD), null when none.
export function wallImbalance(walls, pct = 2) {
  const near = (walls || []).filter((w) => Math.abs(w.distPct) <= pct);
  const bidUsd = sum(near.filter((w) => w.side === 'bid'));
  const askUsd = sum(near.filter((w) => w.side === 'ask'));
  return { bidUsd, askUsd, imbalance: bidUsd + askUsd > 0 ? ((bidUsd - askUsd) / (bidUsd + askUsd)) * 100 : null };
}

// Ended walls in the event log (appeared events are not endings).
export const eventCounts = (events) => ({ pulled: (events || []).filter((e) => e.outcome === 'pulled').length, filled: (events || []).filter((e) => e.outcome === 'filled').length });

export const ageText = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

// Where `price` sits on a strip centred on `ref`, spanning +-range percent: pct 0..100 (clamped) and whether it fell off the strip.
export function ladderPos(price, ref, range) {
  const d = ref > 0 ? ((price - ref) / ref) * 100 : 0;
  return { distPct: d, pct: Math.min(100, Math.max(0, 50 + (d / range) * 50)), off: Math.abs(d) > range };
}
export const ladderRange = (dists) => [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100].find((r) => r >= Math.max(0, ...dists.map(Math.abs))) ?? 100;
