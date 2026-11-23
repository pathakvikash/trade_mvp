// Candles from a klines response, or [] when the response is for another interval/symbol than the one on screen.
// usePolling keeps the old data while only the query string changes, so a timeframe switch would otherwise
// draw the previous timeframe's candles (and a same-length update() on the new chart throws). A bare array has no tag: accepted.
export default function freshCandles(data, symbol, interval) {
  if (Array.isArray(data)) return data;
  if (!Array.isArray(data?.candles)) return [];
  if ((data.interval && data.interval !== interval) || (data.symbol && data.symbol !== symbol)) return [];
  return data.candles;
}
