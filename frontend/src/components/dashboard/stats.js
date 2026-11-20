const fin = (x) => Number.isFinite(x);

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
