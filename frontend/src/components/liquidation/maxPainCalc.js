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
