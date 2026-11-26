// Cumulative volume delta from REAL Binance futures taker volume (kline field 9 = taker buy base volume, field 5 = total base volume).
// delta per candle = takerBuy - (volume - takerBuy). Only Binance futures reports this: Bybit/Bitget/Gate/MEXC klines and the spot mirror
// do not carry it (or it would be spot flow), so when Binance is unreachable the answer is `available:false`, never an approximation.
const binance = require('./marketData/providers/binance');
const { cached } = require('./marketData/cache');
const { fallbackable } = require('./marketData/breaker');

// range -> candle interval and count. CVD starts at 0 on the first candle of the window.
const CVD_RANGES = {
    '6h': { iv: '5m', n: 72 },
    '24h': { iv: '15m', n: 96 },
    '3d': { iv: '1h', n: 72 },
    '1w': { iv: '4h', n: 42 },
};

// raw Binance kline rows -> candles with delta and running cvd (rows with unusable numbers are dropped, never patched)
function cvdSeries(rows) {
    let cvd = 0;
    const candles = [];
    for (const r of rows) {
        const vol = parseFloat(r[5]);
        const buy = parseFloat(r[9]);
        const close = parseFloat(r[4]);
        if (!(vol >= 0) || !(buy >= 0) || buy > vol * 1.000001 || !(close > 0)) continue;
        const sell = Math.max(0, vol - buy);
        cvd += buy - sell;
        candles.push({ time: Math.floor(r[0] / 1000), close, buy, sell, delta: buy - sell, cvd });
    }
    return candles;
}

const cvd = (symbol, range) => cached(`cvd:${symbol}:${range}`, 30000, async () => {
    const { iv, n } = CVD_RANGES[range];
    const base = { symbol, range, interval: iv, generatedAt: Date.now(), unit: 'base' };
    try {
        const candles = cvdSeries(await binance.get('/fapi/v1/klines', { symbol, interval: iv, limit: n }));
        if (!candles.length) throw Object.assign(new Error('no klines'), { response: { status: 200 } });
        return { ...base, available: true, source: 'binance-futures', candles };
    } catch (e) {
        if (!fallbackable(e)) throw e;
        return { ...base, available: false, source: 'unavailable', reason: 'Taker buy/sell volume is only available from Binance futures, which this server cannot reach right now.' };
    }
});

module.exports = { CVD_RANGES, cvdSeries, cvd };
