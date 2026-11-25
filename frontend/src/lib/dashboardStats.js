// Pure helpers for the dashboard's extra cards. Rows are the `${FUT}/overview` rows (top perps by volume).
import { fundingExtremes, weightedFunding } from '../components/dashboard/stats';

const fin = Number.isFinite;
export const FUNDING_HOT = 0.0003; // +-0.03% per 8h

// Open interest total (rows with a missing OI are excluded and counted), volume-weighted funding,
// extreme-funding counts, top 3 funding each way, and gainer/loser breadth.
export function derivativesPulse(rows, n = 40) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, n);
  const oiRows = list.filter((r) => fin(r.openInterestUsd) && r.openInterestUsd > 0);
  const f = list.filter((r) => fin(r.fundingRate));
  const ex = fundingExtremes(list, 3);
  const move = list.filter((r) => fin(r.priceChangePercent));
  return {
    count: list.length,
    oiUsd: oiRows.length ? oiRows.reduce((s, r) => s + r.openInterestUsd, 0) : null,
    oiCount: oiRows.length,
    oiMissing: list.length - oiRows.length,
    funding: weightedFunding(list),
    fundingCount: f.length,
    hot: f.filter((r) => r.fundingRate > FUNDING_HOT).length,
    cold: f.filter((r) => r.fundingRate < -FUNDING_HOT).length,
    mostPositive: ex.high.filter((r) => r.fundingRate > 0),
    mostNegative: ex.low.filter((r) => r.fundingRate < 0),
    up: move.filter((r) => r.priceChangePercent > 0).length,
    down: move.filter((r) => r.priceChangePercent < 0).length,
    moveCount: move.length,
  };
}

// Real-market snapshot: the wanted symbols in order, skipping any the API did not return.
export const SNAPSHOT = ['NIFTY50', 'BANKNIFTY', 'GOLD', 'CRUDEOIL', 'USDINR', 'RELIANCE'];
export const pickInstruments = (rows, wanted = SNAPSHOT) => {
  const by = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.symbol, r]));
  return wanted.map((s) => by.get(s)).filter(Boolean);
};

// Liquidation windows: totals, long share and the largest recent events. null when there is no window data.
export function liqView(data, top = 5) {
  const w = (k) => {
    const x = data?.windows?.[k];
    if (!x || !fin(x.longUsd) || !fin(x.shortUsd)) return null;
    return { long: x.longUsd, short: x.shortUsd, total: x.longUsd + x.shortUsd, count: fin(x.count) ? x.count : null };
  };
  const recent = Array.isArray(data?.recent) ? data.recent : [];
  return { h1: w('1h'), h24: w('24h'), biggest: recent.filter((e) => fin(e.usd)).sort((a, b) => b.usd - a.usd).slice(0, top) };
}
