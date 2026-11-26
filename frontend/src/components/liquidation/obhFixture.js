// Test fixture shared by the order book heatmap tests (not shipped: nothing imports it outside *.test.js).
export const obhFixture = (over = {}) => {
  const lvl = (price, qty, cumQty, cumUsd) => ({ price, qty, usd: Math.round(price * qty), cumQty, cumUsd });
  return {
    symbol: 'BTCUSDT', status: 'ok', source: 'binance-futures', collectedMs: 7 * 60e3, samples: 84, sampleMs: 5000, retainMs: 7200e3, generatedAt: 1e12,
    t0: 1e12, colMs: 5000, cols: 3, rows: 4, priceMin: 100, priceStep: 1, grid: 1, price: 102, lastPrice: 102, max: 500, mids: [102, null, 102.5], gaps: [1],
    cells: [0, 100, 500, 0, 0, 0, 0, 0, 200, 0, 0, 50],
    bands: [0.5, 1, 2, 5],
    book: {
      bestBid: 101.5, bestAsk: 102.5, spread: 1, spreadPct: 0.98,
      bids: [lvl(101.5, 10, 10, 1015), lvl(101, 20, 30, 3035)],
      asks: [lvl(102.5, 5, 5, 513), lvl(103, 8, 13, 1337)],
    },
    depth: { requestedPct: 1, bandPct: 1, partial: false, bidUsd: 3000, bidQty: 30, askUsd: 2000, askQty: 20, imbalance: 20 },
    imbalance: { pct: 20, prevPct: -2.7, prevAgoMs: 5 * 60e3 + 1000 },
    walls: {
      thresholdMult: 10,
      active: [{ side: 'bid', price: 101, usd: 14240000, qty: 140000, peakUsd: 15e6, firstSeen: 1e12 - 120e3, upForMs: 125e3, distPct: -1.16 }],
      largestBid: { side: 'bid', price: 101, usd: 14240000, qty: 140000, peakUsd: 15e6, firstSeen: 1e12 - 120e3, upForMs: 125e3, distPct: -1.16 },
      largestAsk: null,
    },
    wallEvents: [
      { t: 1e12 + 5000, side: 'ask', price: 103, usd: 800000, lifetimeMs: 0, outcome: 'appeared' },
      { t: 1e12 + 9000, side: 'bid', price: 100.5, usd: 600000, lifetimeMs: 90e3, outcome: 'pulled' },
      { t: 1e12 + 12000, side: 'bid', price: 100, usd: 900000, lifetimeMs: 150e3, outcome: 'filled' },
    ],
    trades: [{ t: 1e12 + 2000, price: 102, usd: 20000, side: 'buy' }, { t: 1e12 + 4000, price: 101.5, usd: 9000, side: 'sell' }],
    ...over,
  };
};
