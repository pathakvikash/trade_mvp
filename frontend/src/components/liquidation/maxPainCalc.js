// Max pain from the liqheat payload (no extra fetch): the price bucket with the largest estimated liquidation size.
// `largest` is the biggest bucket of the last column (both sides) as computed server-side; keyLevels are the per-side local peaks.
export function maxPain(d) {
  const big = d && d.largest;
  if (!big || !(big.usd > 0) || !(d.price > 0)) return null;
  const top = (l) => [...(l || [])].sort((a, b) => b.usd - a.usd).slice(0, 3).sort((a, b) => b.price - a.price); // 3 largest, highest price first
  return {
    price: big.price,
    usd: big.usd,
    side: big.side,
    pct: ((big.price / d.price) - 1) * 100,
    above: top(d.keyLevels?.above),
    below: top(d.keyLevels?.below),
    longUsd: d.totals?.longUsd || 0,
    shortUsd: d.totals?.shortUsd || 0,
  };
}

// ---- multi-coin Pain field (rows come from GET /futures/maxpain) ----
export const CRITICAL_PCT = 1; // the shaded band: levels within +-1% of the price
export const SQUEEZE_PCT = 2; // two-way squeeze: both sides within 2%

const near = (l) => l && Math.abs(l.pct) <= CRITICAL_PCT;

// Strongest long (below) and short (above) level of a liqheat payload: same rule as the server's row.
export function levelsOf(h) {
  const best = (list) => (list || []).reduce((b, l) => (!b || l.usd > b.usd ? l : b), null);
  const mk = (l) => l && { price: l.price, pct: l.pct, usd: l.usd };
  return { below: mk(best(h?.keyLevels?.below)), above: mk(best(h?.keyLevels?.above)) };
}

// Cross-window agreement for one side: windows whose level price is within 1% of the selected window's level.
export function confluence(levelsByWindow, win, side) {
  const ref = levelsByWindow[win]?.[side];
  if (!ref) return { count: 0, total: 0 };
  const all = Object.values(levelsByWindow).map((x) => x?.[side]).filter(Boolean);
  return { count: all.filter((l) => Math.abs(l.price / ref.price - 1) <= 0.01).length, total: all.length };
}

// Four summary cards. Pull weights each level's estimated $ by 1 / (1 + |distance %|), so nearer levels count more.
export function summarize(rows) {
  let below = 0;
  let above = 0;
  const critical = [];
  const squeeze = [];
  let strongest = null;
  rows.forEach((r) => {
    if (r.below) below += r.below.usd / (1 + Math.abs(r.below.pct));
    if (r.above) above += r.above.usd / (1 + Math.abs(r.above.pct));
    [['long', r.below], ['short', r.above]].forEach(([side, l]) => {
      if (near(l)) critical.push({ symbol: r.symbol, side, usd: l.usd });
      if (l && (!strongest || l.usd > strongest.usd)) strongest = { symbol: r.symbol, side, usd: l.usd, pct: l.pct };
    });
    if (r.below && r.above && Math.abs(r.below.pct) <= SQUEEZE_PCT && r.above.pct <= SQUEEZE_PCT) squeeze.push({ symbol: r.symbol, usd: r.below.usd + r.above.usd });
  });
  const tot = below + above;
  const byUsd = (a, b) => b.usd - a.usd;
  critical.sort(byUsd);
  squeeze.sort(byUsd);
  return {
    belowPct: tot > 0 ? Math.round((below / tot) * 100) : null,
    criticalCount: new Set(critical.map((c) => c.symbol)).size,
    critical: critical.slice(0, 3),
    strongest,
    squeezeCount: squeeze.length,
    squeeze: squeeze.slice(0, 3),
  };
}

// Bubbles for the field. axis 'pct' = distance %, 'sigma' = distance in window sigmas (signed: long pain negative).
// kinds: which of long/short to show; criticalOnly keeps |pct| <= 1.
export function bubblesOf(rows, { axis = 'pct', long = true, short = true, criticalOnly = false } = {}) {
  const out = [];
  let noSigma = 0;
  rows.forEach((r) => {
    [['long', r.below, long, -1], ['short', r.above, short, 1]].forEach(([side, l, on, sign]) => {
      if (!l || !on || (criticalOnly && !near(l))) return;
      const x = axis === 'sigma' ? (l.sigma == null ? null : sign * l.sigma) : l.pct;
      if (x == null) { noSigma += 1; return; }
      out.push({ key: `${r.symbol}:${side}`, symbol: r.symbol, side, x, usd: l.usd, pct: l.pct, price: l.price });
    });
  });
  return { items: out, noSigma };
}

// Deterministic collision-avoiding layout: biggest first, x fixed by value, y searched outward from the centre line in
// fixed steps until the circle clears every placed one (ties go up before down). Falls back to the least-bad slot.
export function layoutBubbles(items, { width, height, rMin = 14, rMax = 34, pad = 28, xMax } = {}) {
  const limit = xMax || Math.max(1.5, ...items.map((i) => Math.abs(i.x)));
  const maxUsd = Math.max(1, ...items.map((i) => i.usd));
  const half = (width - 2 * pad) / 2;
  const cy = height / 2;
  const placed = [];
  [...items].sort((a, b) => b.usd - a.usd || (a.key < b.key ? -1 : 1)).forEach((it) => {
    const r = rMin + Math.sqrt(it.usd / maxUsd) * (rMax - rMin);
    const cx = width / 2 + (Math.max(-limit, Math.min(limit, it.x)) / limit) * half;
    const step = 4;
    const lim = height / 2 - r;
    let y = cy;
    let found = false;
    for (let k = 0; k * step <= lim && !found; k++) {
      for (const s of k === 0 ? [0] : [-1, 1]) {
        const cand = cy + s * k * step;
        if (placed.every((p) => Math.hypot(p.cx - cx, p.cy - cand) >= p.r + r + 1)) { y = cand; found = true; break; }
      }
    }
    placed.push({ ...it, cx, cy: y, r });
  });
  return { nodes: placed, xMax: limit };
}

// Table row model: one flat record per coin so sorting getters stay trivial.
export const tableRow = (r) => {
  const sig = [r.below?.sigma, r.above?.sigma].filter((v) => v != null);
  return {
    symbol: r.symbol,
    longPrice: r.below?.price ?? null, longPct: r.below ? r.below.pct : null,
    shortPrice: r.above?.price ?? null, shortPct: r.above ? r.above.pct : null,
    usd: (r.below?.usd || 0) + (r.above?.usd || 0),
    sigma: sig.length ? Math.min(...sig) : null,
  };
};
