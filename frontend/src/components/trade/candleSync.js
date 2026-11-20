// True when the chart needs a full setData; false means update() with just the newest candle.
export const needsFullReload = (count, len) => count === 0 || len - count > 1 || len < count;

export const INTERVAL_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

// Fold a 1m tick into the last candle of a higher timeframe.
// Returns { candles, refetch }: refetch=true when the tick opens a new bucket (REST has the real candle).
export const foldTick = (candles, tick, sec) => {
  const last = candles[candles.length - 1];
  if (!last || tick.time < last.time) return { candles, refetch: false };
  if (tick.time >= last.time + sec) return { candles, refetch: true };
  const next = {
    ...last,
    high: Math.max(last.high, tick.high),
    low: Math.min(last.low, tick.low),
    close: tick.close,
  };
  return { candles: [...candles.slice(0, -1), next], refetch: false };
};
