// Pure pair filtering for PairPicker.
const MAX = 50;

// Prefix matches (base, then symbol) first, then substring matches; with no query, most-traded first.
export function filterPairs(symbols, q, vol) {
  const s = q.trim().toUpperCase();
  const rank = (p) => (!s ? 0 : p.base.startsWith(s) ? 0 : p.symbol.startsWith(s) ? 1 : 2);
  return symbols
    .filter((p) => !s || p.symbol.includes(s) || p.base.includes(s))
    .map((p) => [rank(p), -(vol.get(p.symbol)?.quoteVolume || 0), p])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2].symbol < b[2].symbol ? -1 : 1))
    .slice(0, MAX)
    .map((x) => x[2]);
}
