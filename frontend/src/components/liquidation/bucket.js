// Pure bucketing of liquidation events into a time x price grid (row 0 = lowest price).
// events: [{side:'long'|'short', price, usd, ts}]. Events outside [t0,t1) or [lo,hi] are ignored.
// If lo/hi are omitted they come from the events; a single price gets a +-0.5% band.
export function bucketLiquidations(events, { t0, t1, cols, rows, lo, hi }) {
  const inTime = events.filter((e) => e.ts >= t0 && e.ts < t1);
  let min = lo;
  let max = hi;
  if (min === undefined || max === undefined) {
    const prices = inTime.map((e) => e.price);
    min = prices.length ? Math.min(...prices) : 0;
    max = prices.length ? Math.max(...prices) : 0;
  }
  if (max - min <= 0) {
    const pad = (Math.abs(min) || 1) * 0.005;
    min -= pad;
    max += pad;
  }
  const long = new Float64Array(cols * rows);
  const short = new Float64Array(cols * rows);
  let longUsd = 0;
  let shortUsd = 0;
  let count = 0;
  for (const e of inTime) {
    if (e.price < min || e.price > max) continue;
    const c = Math.min(cols - 1, Math.floor(((e.ts - t0) / (t1 - t0)) * cols));
    const r = Math.min(rows - 1, Math.floor(((e.price - min) / (max - min)) * rows));
    (e.side === 'long' ? long : short)[r * cols + c] += e.usd;
    if (e.side === 'long') longUsd += e.usd; else shortUsd += e.usd;
    count += 1;
  }
  return {
    cols, rows, lo: min, hi: max, t0, t1, long, short, count, longUsd, shortUsd,
    maxLong: Math.max(0, ...long),
    maxShort: Math.max(0, ...short),
  };
}
