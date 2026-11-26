// Pure maths for the liquidation map: tiers, stacked buckets, cumulative lines, stat cards, range windows.
// Levels come from /futures/liqmap: [{price, longUsd, shortUsd, longTier?[], shortTier?[]}]; tier arrays line up with data.tiers.

// Longs are liquidated below the price, shorts above. Colours: long = rose family, short = emerald family (as before), darker = higher leverage.
export const LONG_SHADES = ['#fda4af', '#fb7185', '#e11d48', '#9f1239'];
export const SHORT_SHADES = ['#6ee7b7', '#34d399', '#059669', '#065f46'];

// Old payloads (no tiers) become one "All" tier so the map still draws.
export function tiersOf(data) {
  return Array.isArray(data?.tiers) && data.tiers.length ? data.tiers : [{ id: 'all', label: 'All' }];
}

const part = (l, key, tiers) => {
  const arr = l[`${key}Tier`];
  return tiers.map((_, i) => (Array.isArray(arr) ? arr[i] || 0 : tiers.length === 1 ? l[`${key}Usd`] || 0 : 0));
};

// on: {tierId: bool} (missing = on). Returns buckets with per-tier long/short (disabled tiers zeroed) and cumulative lines:
//   cumLong(p)  = long liquidations in [p, price)  -> largest at the far left, falls to 0 at the price
//   cumShort(p) = short liquidations in (price, p] -> 0 at the price, largest at the far right
export function buildMap(levels, price, tiers, on = {}) {
  const act = tiers.map((t) => on[t.id] !== false);
  const rows = levels.map((l) => {
    const isLong = l.price < price;
    const long = isLong ? part(l, 'long', tiers).map((v, i) => (act[i] ? v : 0)) : tiers.map(() => 0);
    const short = isLong ? tiers.map(() => 0) : part(l, 'short', tiers).map((v, i) => (act[i] ? v : 0));
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    return { price: l.price, long, short, longUsd: sum(long), shortUsd: sum(short), cumLong: 0, cumShort: 0 };
  });
  let c = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].price < price) { c += rows[i].longUsd; rows[i].cumLong = c; }
  c = 0;
  rows.forEach((r) => { if (r.price >= price) { c += r.shortUsd; r.cumShort = c; } });
  const totalLong = rows.reduce((s, r) => s + r.longUsd, 0);
  const totalShort = rows.reduce((s, r) => s + r.shortUsd, 0);
  return { rows, totalLong, totalShort, maxBar: Math.max(1, ...rows.map((r) => r.longUsd + r.shortUsd)), maxCum: Math.max(1, totalLong, totalShort) };
}

// The 4 stat cards. Distances are % of the current price (negative = below).
export function liqStats(map, price, within = 0.02) {
  const { rows, totalLong, totalShort } = map;
  const longNear = rows.filter((r) => r.price < price && r.price >= price * (1 - within)).reduce((s, r) => s + r.longUsd, 0);
  const shortNear = rows.filter((r) => r.price >= price && r.price <= price * (1 + within)).reduce((s, r) => s + r.shortUsd, 0);
  const top = rows.reduce((b, r) => (r.longUsd + r.shortUsd > (b ? b.longUsd + b.shortUsd : 0) ? r : b), null);
  return {
    longNear,
    shortNear,
    cluster: top ? { price: top.price, usd: top.longUsd + top.shortUsd, distPct: ((top.price - price) / price) * 100, side: top.price < price ? 'long' : 'short' } : null,
    totalLong,
    totalShort,
    ratio: totalShort > 0 ? totalLong / totalShort : null,
  };
}

export const distPct = (p, price) => ((p - price) / price) * 100;

// Range selector chips: visible window = price +-pct as a zoom view over the full level span [lo, hi]; null = whole range.
export function viewForRange(pct, price, lo, hi) {
  if (pct == null) return { k: 1, ox: 0, oy: 0 };
  const full = hi - lo;
  const a = Math.max(lo, price * (1 - pct));
  const b = Math.min(hi, price * (1 + pct));
  const w = (b - a) / full;
  return w >= 1 || !(w > 0) ? { k: 1, ox: 0, oy: 0 } : { k: 1 / w, ox: (a - lo) / full, oy: 0 };
}
