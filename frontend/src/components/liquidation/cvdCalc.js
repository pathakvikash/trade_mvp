export const CVD_RANGES = ['6h', '24h', '3d', '1w'].map((id) => ({ id, label: id }));

// Plain-language description of a window (not advice). share = net delta as % of all traded volume.
export function cvdRead(candles) {
  if (!candles || candles.length < 2) return null;
  const sum = (a, k) => a.reduce((s, c) => s + c[k], 0);
  const vol = sum(candles, 'buy') + sum(candles, 'sell');
  if (!(vol > 0)) return null;
  const share = (candles[candles.length - 1].cvd / vol) * 100;
  const label = (s) => (s > 5 ? 'buyers dominating' : s < -5 ? 'sellers dominating' : 'balanced');
  const tail = candles.slice(-Math.max(2, Math.floor(candles.length / 4))); // latest quarter of the window
  const tailVol = sum(tail, 'buy') + sum(tail, 'sell');
  const recent = tailVol > 0 ? (sum(tail, 'delta') / tailVol) * 100 : 0;
  return {
    share, label: label(share), recent, recentLabel: label(recent),
    priceChange: ((candles[candles.length - 1].close / candles[0].close) - 1) * 100,
    net: candles[candles.length - 1].cvd,
  };
}

// ---- CVD tool (futures vs spot, view-anchored). Everything below is a pure description of past flow, never a forecast. ----
export const CVD_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map((id) => ({ id, label: id === '1d' ? '1D' : id }));
export const TRADE_THRESHOLDS = [10e3, 50e3, 100e3, 500e3, 1e6];
export const thresholdLabel = (n) => (n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}K`);
export const filterTrades = (items, min) => (items || []).filter((t) => t.usd >= min);

export const sliceView = (candles, view) => (view ? candles.filter((c) => c.time >= view.from && c.time <= view.to) : candles);
// cvd restarted at the first candle of `candles` (the "start of view" anchor)
export const rebased = (candles) => { let s = 0; return candles.map((c) => ({ ...c, cvd: (s += c.delta) })); };

const share = (x) => (x.buy + x.sell > 0 ? (x.net / (x.buy + x.sell)) * 100 : 0);
function flow(candles) {
  if (!candles || !candles.length) return null;
  const f = { buy: 0, sell: 0, net: 0 };
  candles.forEach((c) => { f.buy += c.buy; f.sell += c.sell; f.net += c.delta; });
  return { ...f, share: share(f) };
}
const dir = (f) => (f.share > 2 ? 'buying' : f.share < -2 ? 'selling' : 'flat');

// Who leads: |net / volume| of futures vs spot over the same view. Texts only describe the view, e.g. "futures buying, spot selling".
export function spotVsFutures(f, s) {
  if (!f && !s) return null;
  if (!f || !s) return { text: f ? `futures ${dir(f)}; spot unavailable from this source` : `spot ${dir(s)}; futures unavailable from this source`, tag: 'One source only' };
  const df = dir(f); const ds = dir(s);
  const tag = df === 'flat' && ds === 'flat' ? 'No clear lead'
    : df !== ds && df !== 'flat' && ds !== 'flat' ? 'Diverging'
      : Math.abs(f.share) === Math.abs(s.share) ? 'No clear lead' : Math.abs(f.share) > Math.abs(s.share) ? 'Futures lead' : 'Spot lead';
  return { text: `futures ${df}, spot ${ds}`, tag };
}

// Price makes a new high (low) over the previous `lookback` candles while cvd does not = bearish (bullish) divergence.
// cvd is the series' own running total from the window start; one marker per run of the same type (first candle of the run).
export function detectDivergences(candles, lookback = 20) {
  const out = [];
  let last = null;
  for (let i = lookback; i < (candles || []).length; i++) {
    const prev = candles.slice(i - lookback, i);
    const c = candles[i];
    const hi = Math.max(...prev.map((p) => p.high));
    const lo = Math.min(...prev.map((p) => p.low));
    const cHi = Math.max(...prev.map((p) => p.cvd));
    const cLo = Math.min(...prev.map((p) => p.cvd));
    let d = null;
    if (c.high > hi && c.cvd <= cHi) d = { type: 'bearish', price: c.high, cvdDelta: c.cvd - cHi };
    else if (c.low < lo && c.cvd >= cLo) d = { type: 'bullish', price: c.low, cvdDelta: c.cvd - cLo };
    if (d && !(last && last.type === d.type && last.i === i - 1)) out.push({ time: c.time, cvd: c.cvd, ...d });
    last = d ? { type: d.type, i } : null;
  }
  return out;
}

// The six stat cards for the visible part of the window. fut/spot: payload candles or null (unavailable).
export function cvdStats(fut, spot, view, lookback) {
  const f = fut ? sliceView(fut, view) : null;
  const s = spot ? sliceView(spot, view) : null;
  const px = (f && f.length ? f : s) || [];
  const ff = flow(f); const sf = flow(s);
  const all = fut || spot;
  const divs = all ? detectDivergences(all, lookback) : [];
  return {
    price: px.length ? { last: px[px.length - 1].close, changePct: (px[px.length - 1].close / px[0].close - 1) * 100 } : null,
    fut: ff, spot: sf,
    takerBuyPct: ff && ff.buy + ff.sell > 0 ? (ff.buy / (ff.buy + ff.sell)) * 100 : null,
    lead: spotVsFutures(ff, sf),
    divergence: divs.length ? divs[divs.length - 1] : null,
  };
}

// CVD lines on the price grid (times of `grid`): whitespace before the anchor so every pane keeps the same time axis.
// show: 'vs' | 'combined' | 'fut' | 'spot'. scale 'norm' divides each line by its largest |value| in view, 'abs' leaves base units.
export function buildLines(fut, spot, { show, scale, view, anchor, grid }) {
  const fm = new Map((fut || []).map((c) => [c.time, c]));
  const sm = new Map((spot || []).map((c) => [c.time, c]));
  const start = anchor === 'view' && view ? view.from : -Infinity;
  const end = view ? view.to : Infinity;
  const mk = (id, label, color, delta) => {
    let sum = 0;
    const data = grid.map((t) => {
      const d = delta(t);
      if (t < start || d == null) return { time: t };
      sum += d;
      return { time: t, value: sum };
    });
    let m = 0;
    if (scale === 'norm') data.forEach((p) => { if (p.value !== undefined && p.time <= end) m = Math.max(m, Math.abs(p.value)); });
    return { id, label, color, data: m > 0 ? data.map((p) => (p.value === undefined ? p : { time: p.time, value: p.value / m })) : data };
  };
  const dF = (t) => fm.get(t)?.delta;
  const dS = (t) => sm.get(t)?.delta;
  const lines = [];
  if (show === 'combined') {
    if (fut && spot) lines.push(mk('combined', 'Combined', '#a78bfa', (t) => (fm.has(t) && sm.has(t) ? dF(t) + dS(t) : null)));
  } else {
    if (fut && show !== 'spot') lines.push(mk('fut', 'Futures', '#22d3ee', dF));
    if (spot && show !== 'fut') lines.push(mk('spot', 'Spot', '#fbbf24', dS));
  }
  return lines;
}
