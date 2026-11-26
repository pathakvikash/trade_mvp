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
