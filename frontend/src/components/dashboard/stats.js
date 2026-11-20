const fin = (x) => Number.isFinite(x);
const base = (s) => (s || '').replace(/USDT$/, '');

export const totalOi = (rows) => rows.reduce((s, r) => s + (fin(r.openInterestUsd) ? r.openInterestUsd : 0), 0);

// Funding averaged by quoteVolume weight; returns the raw fraction (0.0001 = 0.01%) or null.
export function weightedFunding(rows) {
  let w = 0;
  let sum = 0;
  rows.forEach((r) => {
    if (fin(r.fundingRate) && fin(r.quoteVolume) && r.quoteVolume > 0) {
      w += r.quoteVolume;
      sum += r.fundingRate * r.quoteVolume;
    }
  });
  return w ? sum / w : null;
}

export function topMovers(rows, n = 5) {
  const s = rows.filter((r) => fin(r.priceChangePercent)).sort((a, b) => b.priceChangePercent - a.priceChangePercent);
  return { gainers: s.slice(0, n), losers: s.slice(-n).reverse() };
}

export function fundingExtremes(rows, n = 5) {
  const s = rows.filter((r) => fin(r.fundingRate)).sort((a, b) => b.fundingRate - a.fundingRate);
  return { high: s.slice(0, n), low: s.slice(-n).reverse() };
}

// Of the top n perps by quote volume, how many are up over 24h. `total` is what was available (may be < n).
export function breadth(rows, n = 50) {
  const s = rows
    .filter((r) => fin(r.priceChangePercent) && fin(r.quoteVolume))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, n);
  return { up: s.filter((r) => r.priceChangePercent > 0).length, total: s.length };
}

// Count of perps with positive, negative and zero funding (missing funding is skipped).
export function fundingSplit(rows) {
  const out = { pos: 0, neg: 0, zero: 0, total: 0 };
  rows.forEach((r) => {
    if (!fin(r.fundingRate)) return;
    if (r.fundingRate > 0) out.pos += 1;
    else if (r.fundingRate < 0) out.neg += 1;
    else out.zero += 1;
    out.total += 1;
  });
  return out;
}

// Open interest: total USD across perps with a positive value, and the largest n symbols with their shares.
export function oiShare(rows, n = 3) {
  const s = rows
    .filter((r) => fin(r.openInterestUsd) && r.openInterestUsd > 0)
    .sort((a, b) => b.openInterestUsd - a.openInterestUsd);
  const total = s.reduce((x, r) => x + r.openInterestUsd, 0);
  const top = s.slice(0, n).map((r) => ({ symbol: base(r.symbol), usd: r.openInterestUsd, share: total ? r.openInterestUsd / total : 0 }));
  return { total, top };
}

// One movers tab: gainers | losers | volume | funding (highest funding first).
export function moverList(rows, tab, n = 8) {
  if (tab === 'gainers') return topMovers(rows, n).gainers;
  if (tab === 'losers') return topMovers(rows, n).losers;
  if (tab === 'volume') return rows.filter((r) => fin(r.quoteVolume)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, n);
  if (tab === 'funding') return fundingExtremes(rows, n).high;
  return [];
}

// Holdings valued at the live futures price (same rule as Portfolio: a missing price stays null, never $0).
// Totals are null while any holding lacks a price. Holdings use the base symbol (BTC), rows use BTCUSDT.
export function valueHoldings(holdings, rows) {
  const px = {};
  rows.forEach((r) => { px[base(r.symbol)] = r.lastPrice ?? r.markPrice; });
  const items = holdings.map((h) => {
    const cost = h.amount * h.avgCost;
    const price = fin(px[h.symbol]) ? px[h.symbol] : null;
    if (price === null) return { symbol: h.symbol, amount: h.amount, cost, price: null, value: null, pnl: null, pnlPct: null };
    const value = h.amount * price;
    const pnl = value - cost;
    return { symbol: h.symbol, amount: h.amount, cost, price, value, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : null };
  });
  const complete = items.every((i) => i.value !== null);
  const value = complete ? items.reduce((s, i) => s + i.value, 0) : null;
  const cost = items.reduce((s, i) => s + i.cost, 0);
  const pnl = complete ? items.reduce((s, i) => s + i.pnl, 0) : null;
  return { items, value, cost, pnl, pnlPct: pnl !== null && cost > 0 ? (pnl / cost) * 100 : null };
}

// Account allocation: cash plus holdings values, largest holding first, each with its share of the total.
export function allocation(cash, items) {
  const cashV = fin(cash) ? cash : 0;
  const parts = items.filter((i) => fin(i.value) && i.value > 0).map((i) => ({ symbol: i.symbol, value: i.value }));
  const total = cashV + parts.reduce((s, p) => s + p.value, 0);
  const sorted = parts.sort((a, b) => b.value - a.value).map((p) => ({ ...p, share: total > 0 ? p.value / total : 0 }));
  return { total, cash: cashV, items: sorted };
}
