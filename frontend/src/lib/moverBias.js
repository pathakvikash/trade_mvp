// Deterministic "trade bias" for a top mover. Pure: same numbers in, same answer out, no network, no model.
// Each factor scores -1..+1 (positive = long lean) from data the app already has; a missing input is reported, never guessed.
// This is an analysis aid for paper trading, not a prediction and not advice. Thresholds are fixed rules, not fitted to outcomes.

export const TH = {
  move: 2,            // |24h %| below this is "no clear move"
  fundHigh: 0.0005,   // 0.05% per 8h: crowded
  fundMid: 0.0002,    // 0.02%
  oiMove: 2,          // |24h OI change %| below this is flat
  lsHigh: 2,          // long/short account ratio: >= crowded longs
  lsLow: 0.8,         // <= crowded shorts
  clusterNear: 5,     // % distance within which a liquidation cluster counts
  clusterMin: 0.5,    // a cluster is a bucket holding >= 50% of the biggest bucket on the map
  stop: 3,            // % fallback invalidation distance when no cluster is known
};
export const LONG_MIN = 1;   // |score| needed for Long/Short; below it the answer is Wait

const fin = (x) => Number.isFinite(x);
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const pct = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`;

// 24h OI change in %, from an hourly series [{oiUsd}] (first vs last of up to the latest 25 points). null when not computable.
export function oiChangePct(series) {
  const pts = (Array.isArray(series) ? series : []).map((p) => p && p.oiUsd).filter((v) => fin(v) && v > 0).slice(-25);
  if (pts.length < 6) return null;
  return ((pts[pts.length - 1] - pts[0]) / pts[0]) * 100;
}

// Latest long/short account ratio from [{ratio}], or null.
export function lastRatio(series) {
  const arr = Array.isArray(series) ? series : [];
  for (let i = arr.length - 1; i >= 0; i -= 1) if (arr[i] && fin(arr[i].ratio) && arr[i].ratio > 0) return arr[i].ratio;
  return null;
}

// Nearest estimated liquidation clusters around `price` from liqmap levels [{price,longUsd,shortUsd}].
// above = short liquidations (fuel for a squeeze up), below = long liquidations. Each is {price, distPct, usd} or null.
export function nearestClusters(levels, price) {
  if (!Array.isArray(levels) || !fin(price) || price <= 0) return null;
  const rows = levels.filter((l) => l && fin(l.price) && fin(l.longUsd) && fin(l.shortUsd));
  const max = Math.max(0, ...rows.map((l) => Math.max(l.longUsd, l.shortUsd)));
  if (!rows.length || max <= 0) return null;
  const big = max * TH.clusterMin;
  const above = rows.filter((l) => l.price > price && l.shortUsd >= big).sort((a, b) => a.price - b.price)[0];
  const below = rows.filter((l) => l.price < price && l.longUsd >= big).sort((a, b) => b.price - a.price)[0];
  return {
    above: above ? { price: above.price, distPct: ((above.price - price) / price) * 100, usd: above.shortUsd } : null,
    below: below ? { price: below.price, distPct: ((price - below.price) / price) * 100, usd: below.longUsd } : null,
  };
}

// input: { change24h (%), funding (fraction per 8h), oiChange24h (%), lsRatio, liq: nearestClusters(), price }
// Each factor: { id, label, score, note } or null when its input is missing (listed in `missing`).
function factors(i) {
  const f = [];
  const miss = [];
  const add = (id, label, ok, fn) => { if (ok) f.push({ id, label, ...fn() }); else miss.push(label); };
  const chg = i.change24h;

  add('momentum', '24h move', fin(chg), () => (Math.abs(chg) < TH.move
    ? { score: 0, note: `24h move ${pct(chg)} is small, no clear direction.` }
    : { score: 0.5 * sgn(chg), note: `Price ${pct(chg)} in 24h: momentum leans ${chg > 0 ? 'long' : 'short'}.` }));

  add('funding', 'funding', fin(i.funding), () => {
    const fr = i.funding;
    const t = `Funding ${(fr * 100).toFixed(4)}%`;
    if (fr >= TH.fundHigh) return { score: -1, note: `${t}: longs are paying heavily (crowded longs), a pullback or long squeeze is more likely.` };
    if (fr >= TH.fundMid) return { score: -0.5, note: `${t}: longs are somewhat crowded.` };
    if (fr <= -TH.fundHigh) return { score: 1, note: `${t}: shorts are paying heavily (crowded shorts), short-squeeze risk.` };
    if (fr <= -TH.fundMid) return { score: 0.5, note: `${t}: shorts are somewhat crowded.` };
    return { score: 0, note: `${t}: funding is not stretched.` };
  });

  add('oi', 'open interest', fin(i.oiChange24h) && fin(chg), () => {
    const o = i.oiChange24h;
    if (Math.abs(o) < TH.oiMove || Math.abs(chg) < TH.move) return { score: 0, note: `Open interest ${pct(o)} in 24h: flat or no clear price move, no signal.` };
    // Rising OI with the move = new positions backing it; falling OI = the move is closing positions, a weaker move.
    const back = o > 0;
    return { score: (back ? 0.5 : -0.5) * sgn(chg), note: back ? `Open interest ${pct(o)} with the move: new positions back it.` : `Open interest ${pct(o)} against the move: it is mostly positions closing, so it looks weaker.` };
  });

  add('ratio', 'long/short ratio', fin(i.lsRatio), () => {
    const r = i.lsRatio;
    if (r >= TH.lsHigh) return { score: -0.5, note: `Long/short account ratio ${r.toFixed(2)}: accounts are heavily long.` };
    if (r <= TH.lsLow) return { score: 0.5, note: `Long/short account ratio ${r.toFixed(2)}: accounts are heavily short.` };
    return { score: 0, note: `Long/short account ratio ${r.toFixed(2)}: balanced.` };
  });

  add('liq', 'liquidation map (estimate)', Boolean(i.liq), () => {
    const { above, below } = i.liq;
    const a = above && above.distPct <= TH.clusterNear ? above : null;
    const b = below && below.distPct <= TH.clusterNear ? below : null;
    if (a && (!b || a.distPct < b.distPct)) return { score: 0.5, note: `Estimated short-liquidation cluster ${a.distPct.toFixed(1)}% above: nearer fuel for an upward push.` };
    if (b && (!a || b.distPct < a.distPct)) return { score: -0.5, note: `Estimated long-liquidation cluster ${b.distPct.toFixed(1)}% below: nearer fuel for a downward push.` };
    return { score: 0, note: 'No estimated liquidation cluster close on either side (estimate).' };
  });
  return { factors: f, missing: miss };
}

function invalidation(bias, i) {
  const px = i.price;
  if (bias === 'Wait') return 'Re-check when funding, open interest and the move agree, or after the next data refresh.';
  const cl = i.liq;
  const levelTxt = (v) => String(Number(v.toPrecision(5)));
  if (!fin(px) || px <= 0) return bias === 'Long' ? 'Idea is cancelled if price keeps falling.' : 'Idea is cancelled if price keeps rising.';
  if (bias === 'Long') {
    if (cl && cl.below && cl.below.distPct <= 10) return `Cancelled if price trades below ${levelTxt(cl.below.price)} (nearest estimated long-liquidation cluster).`;
    return `Cancelled if price trades below ${levelTxt(px * (1 - TH.stop / 100))} (fixed ${TH.stop}% under the current price).`;
  }
  if (cl && cl.above && cl.above.distPct <= 10) return `Cancelled if price trades above ${levelTxt(cl.above.price)} (nearest estimated short-liquidation cluster).`;
  return `Cancelled if price trades above ${levelTxt(px * (1 + TH.stop / 100))} (fixed ${TH.stop}% over the current price).`;
}

// Returns { bias: 'Long'|'Short'|'Wait', confidence: 'Low'|'Medium'|'High', score, reasons[], missing[], invalidation, factors[] }.
export function moverBias(input = {}) {
  const { factors: fs, missing } = factors(input);
  const score = fs.reduce((s, x) => s + x.score, 0);
  const reasons = fs.map((x) => x.note);
  const out = (bias, confidence, why) => ({
    bias, confidence, score, missing, factors: fs,
    reasons: [...(why ? [why] : []), ...reasons].slice(0, 4),
    invalidation: invalidation(bias, input),
  });

  // The 24h move and funding are the core inputs: without either, no call.
  if (missing.includes('24h move') || missing.includes('funding')) return out('Wait', 'Low', `Not enough data (${missing.join(', ')}), so no call is made.`);
  if (fs.length < 3) return out('Wait', 'Low', 'Too few inputs are available to form a view.');

  const dir = sgn(score);
  const agree = fs.filter((x) => sgn(x.score) === dir && dir !== 0).length;
  const conflict = fs.filter((x) => sgn(x.score) === -dir && dir !== 0).length;
  if (Math.abs(score) < LONG_MIN) return out('Wait', 'Low', conflict ? 'Factors conflict, so there is no clear side.' : 'Signals are too weak for a side.');
  if (conflict > 0 && agree - conflict < 2) return out('Wait', 'Low', 'Factors conflict, so there is no clear side.');
  const confidence = conflict === 0 && agree >= 4 ? 'High' : agree >= 3 ? 'Medium' : 'Low';
  return out(dir > 0 ? 'Long' : 'Short', confidence, null);
}
