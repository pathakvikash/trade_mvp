// Deterministic read-outs from /stats (+ optional price closes). Returns plain-English lines.
const last = (a) => (a && a.length ? a[a.length - 1] : null);
const chg = (a, f) => (a && a.length > 1 && f(a[0]) > 0 ? f(last(a)) / f(a[0]) - 1 : null);
const sign = (v, t) => (v > t ? 1 : v < -t ? -1 : 0);

export function readouts(stats, closes) {
  if (!stats) return [];
  const out = [];
  const fr = last(stats.funding);
  const f = fr ? sign(fr.rate, 0.00005) : null;
  const oi = chg(stats.openInterest, (p) => p.oiUsd);
  const o = oi === null ? null : sign(oi, 0.01);
  const px = closes && closes.length > 1 ? closes[closes.length - 1] / closes[0] - 1 : null;
  const p = px === null ? null : sign(px, 0.01);

  if (f !== null && o !== null) {
    if (f === 1) out.push(o === 1 ? 'Funding positive and OI rising: longs are paying and adding.' : o === -1 ? 'Funding positive but OI falling: longs are paying and closing.' : 'Funding positive with OI flat: longs pay, positioning is stable.');
    else if (f === -1) out.push(o === 1 ? 'Funding negative and OI rising: shorts are paying and adding.' : o === -1 ? 'Funding negative but OI falling: shorts are paying and covering.' : 'Funding negative with OI flat: shorts pay, positioning is stable.');
    else out.push('Funding near zero: no strong lean from the funding rate.');
  }
  if (p === 1 && o === -1) out.push('Price up while OI falls: the move looks like short covering, not new longs.');
  if (p === 1 && o === 1) out.push('Price and OI both rising: new money is backing the move.');
  if (p === -1 && o === -1) out.push('Price down while OI falls: positions are being closed or liquidated.');
  if (p === -1 && o === 1) out.push('Price down while OI rises: new shorts are being opened into the drop.');

  const ls = last(stats.longShort);
  const top = last(stats.topLongShort);
  if (ls) {
    if (ls.ratio >= 1.5) out.push(`Accounts lean long (${ls.ratio.toFixed(2)}): crowded long side.`);
    else if (ls.ratio <= 0.7) out.push(`Accounts lean short (${ls.ratio.toFixed(2)}): crowded short side.`);
  }
  if (ls && top) {
    if (top.ratio > 1 && ls.ratio < 1) out.push('Top traders are net long while accounts overall lean short.');
    else if (top.ratio < 1 && ls.ratio > 1) out.push('Top traders are net short while accounts overall lean long.');
  }
  const tk = last(stats.takerBuySell);
  if (tk) {
    if (tk.ratio >= 1.1) out.push(`Taker flow favours buyers (${tk.ratio.toFixed(2)}): aggressive buying.`);
    else if (tk.ratio <= 0.9) out.push(`Taker flow favours sellers (${tk.ratio.toFixed(2)}): aggressive selling.`);
  }
  return out;
}
