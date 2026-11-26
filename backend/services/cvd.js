// Cumulative volume delta from REAL Binance taker volume (kline field 9 = taker buy base volume, field 5 = total base volume).
// delta per candle = takerBuy - (volume - takerBuy). FUTURES comes from fapi klines; SPOT from the Binance spot klines (same fields).
// Only Binance reports taker volume: Bybit/Bitget/Gate/MEXC klines do not, so a source that cannot be reached is `available:false`
// with a reason, never an approximation. Futures and spot are separate series in one payload; each can be unavailable alone.
const binance = require('./marketData/providers/binance');
const { cached } = require('./marketData/cache');
const { fallbackable } = require('./marketData/breaker');

// range -> candle interval and count (the original API). CVD starts at 0 on the first candle of the window.
const CVD_RANGES = {
    '6h': { iv: '5m', n: 72 },
    '24h': { iv: '15m', n: 96 },
    '3d': { iv: '1h', n: 72 },
    '1w': { iv: '4h', n: 42 },
};
// interval param -> candle count (a day or so of context for the fast ones, months for 1d)
const CVD_INTERVALS = { '1m': 240, '5m': 288, '15m': 192, '30m': 192, '1h': 168, '4h': 180, '1d': 120 };
const TRADE_MINS = [10000, 50000, 100000, 500000, 1000000];

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
        candles.push({
            time: Math.floor(r[0] / 1000), open: parseFloat(r[1]), high: parseFloat(r[2]), low: parseFloat(r[3]), close,
            volume: vol, buy, sell, delta: buy - sell, cvd,
        });
    }
    return candles;
}

const spotSide = async (symbol, iv, n) => {
    try {
        const candles = cvdSeries(await binance.spotKlinesRaw(symbol, iv, n));
        if (!candles.length) return { available: false, source: 'unavailable', reason: 'No spot candles for this symbol.' };
        return { available: true, source: 'binance-spot', candles };
    } catch (e) {
        const st = e && e.response && e.response.status;
        return { available: false, source: 'unavailable', reason: st === 400 ? 'No Binance spot market for this symbol.' : 'Binance spot is unreachable from this server right now.' };
    }
};

const futuresSide = async (symbol, iv, n) => {
    try {
        const candles = cvdSeries(await binance.get('/fapi/v1/klines', { symbol, interval: iv, limit: n }));
        if (!candles.length) throw Object.assign(new Error('no klines'), { response: { status: 200 } });
        return { available: true, source: 'binance-futures', candles };
    } catch (e) {
        if (!fallbackable(e)) throw e;
        return { available: false, source: 'unavailable', reason: 'Taker buy/sell volume is only available from Binance futures, which this server cannot reach right now.' };
    }
};

// interval (optional) wins over range; unknown values are the route's job to reject
const cvd = (symbol, range, interval) => {
    const { iv, n } = interval ? { iv: interval, n: CVD_INTERVALS[interval] } : CVD_RANGES[range];
    return cached(`cvd:${symbol}:${iv}:${n}`, 30000, async () => {
        const base = { symbol, range: interval ? null : range, interval: iv, generatedAt: Date.now(), unit: 'base' };
        const [fut, spot] = await Promise.all([futuresSide(symbol, iv, n), spotSide(symbol, iv, n)]);
        const { candles, ...f } = fut;
        return { ...base, ...f, ...(candles && { candles }), spot };
    });
};

// Large-trade USD per clock minute for the last `minutes` minutes (oldest first, empty minutes included so bursts read as gaps).
// Only trades >= min count; side is the taker's. Pure, so the route and the tests share it.
const perMinute = (all, min, now, minutes = 15) => {
    const start = Math.floor(now / 60000) * 60000 - (minutes - 1) * 60000;
    const out = Array.from({ length: minutes }, (_, k) => ({ t: start + k * 60000, buyUsd: 0, sellUsd: 0, n: 0 }));
    for (const x of all) {
        const k = Math.floor((x.ts - start) / 60000);
        if (k < 0 || k >= minutes || x.ts > now || !(x.usd >= min)) continue;
        out[k][x.side === 'buy' ? 'buyUsd' : 'sellUsd'] += x.usd;
        out[k].n += 1;
    }
    return out;
};
const medianOf = (a) => { const s = a.map((x) => x.usd).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

// Large recent trades from the last 1000 Binance futures aggTrades (m = buyer is maker, so the TAKER sold). Description only.
// The window these cover is short on busy symbols, so the 60 s flow reports how many ms it really covers.
const trades = (symbol, min) => cached(`cvdtr:${symbol}`, 5000, async () => {
    const now = Date.now();
    try {
        const rows = await binance.get('/fapi/v1/aggTrades', { symbol, limit: 1000 });
        const all = rows.map((r) => { const price = parseFloat(r.p); const qty = parseFloat(r.q); return { id: r.a, ts: r.T, price, qty, usd: price * qty, side: r.m ? 'sell' : 'buy' }; })
            .filter((t) => t.price > 0 && t.qty > 0);
        if (!all.length) throw Object.assign(new Error('no trades'), { response: { status: 200 } });
        const recent = all.filter((t) => t.ts >= now - 60000);
        const buyUsd = recent.filter((t) => t.side === 'buy').reduce((s, t) => s + t.usd, 0);
        const sellUsd = recent.filter((t) => t.side === 'sell').reduce((s, t) => s + t.usd, 0);
        return { symbol, available: true, source: 'binance-futures', generatedAt: now, flow60: { buyUsd, sellUsd, netUsd: buyUsd - sellUsd, trades: recent.length, coveredMs: Math.min(60000, Math.max(0, now - all[0].ts)) }, windowMs: Math.max(0, now - all[0].ts), count: all.length, medianUsd: medianOf(all), all, now };
    } catch (e) {
        if (!fallbackable(e)) throw e;
        return { symbol, available: false, source: 'unavailable', generatedAt: now, reason: 'Recent trades are not available from this source right now.' };
    }
}).then(({ all, now, ...r }) => (all ? { ...r, min, perMin: perMinute(all, min, now), items: all.filter((t) => t.usd >= min).sort((a, b) => b.ts - a.ts || b.id - a.id).slice(0, 100) } : r));

module.exports = { CVD_RANGES, CVD_INTERVALS, TRADE_MINS, perMinute, cvdSeries, cvd, trades };
