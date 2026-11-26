const { isValidSymbol, normalizeForceOrder, normalizeRestKline, normalizeAggTrade, summarizeLiquidations, estimateLiqLevels, estimateLiqHeat, liqKeyLevels, LEV_MIX, LIQ_TIERS } = require('../services/futuresUtils');

const fo = (S, extra = {}) => ({ E: 1, o: { s: 'ETHUSDT', S, q: '2', p: '1800', ap: '1790', z: '2', T: 5, ...extra } });

describe('normalizeForceOrder', () => {
    test('SELL force order means a long was liquidated; usd = price*qty', () => {
        expect(normalizeForceOrder(fo('SELL'))).toEqual({ symbol: 'ETHUSDT', side: 'long', price: 1790, qty: 2, usd: 3580, ts: 5 });
    });
    test('BUY force order means a short was liquidated', () => {
        expect(normalizeForceOrder(fo('BUY')).side).toBe('short');
    });
    test('falls back to limit price/orig qty when avg price/filled qty are zero', () => {
        const e = normalizeForceOrder(fo('BUY', { ap: '0', z: '0' }));
        expect(e.price).toBe(1800);
        expect(e.usd).toBe(3600);
    });
    test('rejects malformed events', () => {
        expect(normalizeForceOrder(null)).toBeNull();
        expect(normalizeForceOrder(fo('HOLD'))).toBeNull();
        expect(normalizeForceOrder(fo('BUY', { s: 'bad' }))).toBeNull();
    });
});

describe('isValidSymbol', () => {
    test.each(['BTCUSDT', 'ETHUSDT', '1000PEPEUSDT'])('accepts %s', (s) => expect(isValidSymbol(s)).toBe(true));
    test.each(['btcusdt', 'USDT', 'BTCUSD', 'BTC-USDT', '', null, 'A'.repeat(30) + 'USDT'])('rejects %p', (s) =>
        expect(isValidSymbol(s)).toBe(false));
});

test('normalizeRestKline converts ms to sec and strings to numbers', () => {
    expect(normalizeRestKline([60000, '1', '2', '0.5', '1.5', '10'])).toEqual({ time: 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
});

describe('normalizeAggTrade', () => {
    test('m:true (buyer is maker) means taker SELL; m:false means taker BUY', () => {
        expect(normalizeAggTrade({ p: '100.5', q: '0.2', m: true, T: 9 })).toEqual({ price: 100.5, qty: 0.2, side: 'sell', ts: 9 });
        expect(normalizeAggTrade({ p: '100.5', q: '0.2', m: false, T: 9 }).side).toBe('buy');
    });
    test('rejects bad numbers', () => {
        expect(normalizeAggTrade({ p: 'x', q: '1', m: true })).toBeNull();
        expect(normalizeAggTrade(null)).toBeNull();
    });
});

describe('summarizeLiquidations', () => {
    const now = 100 * 3600 * 1000;
    const ev = (symbol, side, usd, ageH) => ({ symbol, side, usd, price: 1, qty: usd, ts: now - ageH * 3600 * 1000 });
    const out = summarizeLiquidations([
        [ev('BTCUSDT', 'long', 100, 0.5), ev('BTCUSDT', 'short', 50, 3)],
        [ev('ETHUSDT', 'short', 500, 10), ev('ETHUSDT', 'long', 7, 30)], // 30h old: ignored
    ], now);
    test('windows', () => {
        expect(out.windows['1h']).toEqual({ longUsd: 100, shortUsd: 0, count: 1 });
        expect(out.windows['4h']).toEqual({ longUsd: 100, shortUsd: 50, count: 2 });
        expect(out.windows['24h']).toEqual({ longUsd: 100, shortUsd: 550, count: 3 });
    });
    test('bySymbol sorted by total usd, recent newest first', () => {
        expect(out.bySymbol.map((s) => s.symbol)).toEqual(['ETHUSDT', 'BTCUSDT']);
        expect(out.bySymbol[1]).toEqual({ symbol: 'BTCUSDT', longUsd: 100, shortUsd: 50, count: 2 });
        expect(out.recent.map((e) => e.usd)).toEqual([100, 50, 500]);
    });
});

describe('estimateLiqLevels', () => {
    const H = 3600;
    const k = (i, low, high, close) => ({ time: i * H, low, high, close });
    // snapshots at T=1h and T=2h: +2000 opened during the candle that opens at 1h (candle 1), entry = its close
    const oiHist = [{ ts: H * 1000, oiUsd: 1000 }, { ts: 2 * H * 1000, oiUsd: 3000 }];
    const tier = [{ lev: 10, w: 1 }];
    const run = (klines) => estimateLiqLevels({ klines, oiHist, price: 100, buckets: 300, span: 0.15, tiers: tier });
    const sum = (rows, key, lo = 0, hi = 1e9) => rows.filter((r) => r.price >= lo && r.price <= hi).reduce((a, r) => a + r[key], 0);

    test('uncrossed levels sit at entry*(1 -/+ (1/lev - mmr)) for low/typical/high entries (25/50/25); rows ascending', () => {
        const rows = run([k(0, 99, 101, 100), k(1, 99, 101, 100), k(2, 99, 101, 100)]);
        expect(sum(rows, 'longUsd')).toBeCloseTo(1000);
        expect(sum(rows, 'shortUsd')).toBeCloseTo(1000);
        expect(sum(rows, 'longUsd', 89.4, 89.6)).toBeCloseTo(250); // 99 * 0.904
        expect(sum(rows, 'longUsd', 90.3, 90.5)).toBeCloseTo(500); // 100 * 0.904
        expect(sum(rows, 'shortUsd', 110.6, 110.8)).toBeCloseTo(250); // 101 * 1.096
        expect(rows.map((r) => r.price)).toEqual([...rows.map((r) => r.price)].sort((a, b) => a - b));
    });
    test('entry is the candle opening at the previous snapshot (T-1h), not the one opening at T', () => {
        const rows = run([k(0, 99, 101, 100), k(1, 99, 101, 100), k(2, 99, 121, 120)]);
        expect(sum(rows, 'longUsd', 89, 92)).toBeCloseTo(1000);
        expect(sum(rows, 'longUsd', 105, 115)).toBe(0);
    });
    test('a later low below the long level removes it; a later high removes the short', () => {
        const rows = run([k(0, 99, 101, 100), k(1, 99, 101, 100), k(2, 89, 111, 100)]);
        expect(sum(rows, 'longUsd')).toBe(0);
        expect(sum(rows, 'shortUsd')).toBe(0);
    });
    test('an earlier crossing does not remove it', () => {
        const rows = run([k(0, 50, 150, 100), k(1, 99, 101, 100), k(2, 99, 101, 100)]);
        expect(sum(rows, 'longUsd')).toBeCloseTo(1000);
    });
    test('OI decreases create nothing', () => {
        const rows = estimateLiqLevels({ klines: [k(0, 99, 101, 100), k(1, 99, 101, 100)], oiHist: [{ ts: H * 1000, oiUsd: 3000 }, { ts: 2 * H * 1000, oiUsd: 1000 }], price: 100, tiers: tier });
        expect(rows.every((r) => r.longUsd === 0 && r.shortUsd === 0)).toBe(true);
    });
    test('rows carry per-tier arrays that sum to the totals and group leverages <=10 / 25 / 50 / 100+', () => {
        const ks = [k(0, 99.9, 100.1, 100), k(1, 99.9, 100.1, 100), k(2, 99.9, 100.1, 100)]; // tight range: nothing crossed
        const mix = [{ lev: 10, w: 0.25 }, { lev: 25, w: 0.25 }, { lev: 50, w: 0.25 }, { lev: 100, w: 0.25 }];
        const rows = estimateLiqLevels({ klines: ks, oiHist, price: 100, buckets: 300, span: 0.15, tiers: mix });
        expect(LIQ_TIERS).toHaveLength(4);
        const t = (key) => LIQ_TIERS.map((_, i) => rows.reduce((a, r) => a + r[key][i], 0));
        t('longTier').forEach((v) => expect(v).toBeCloseTo(250));
        t('shortTier').forEach((v) => expect(v).toBeCloseTo(250));
        rows.forEach((r) => { expect(r.longTier.reduce((a, b) => a + b, 0)).toBeCloseTo(r.longUsd); expect(r.shortTier.reduce((a, b) => a + b, 0)).toBeCloseTo(r.shortUsd); });
    });
    test('default leverage mix weights sum to 1; a level whose maintenance margin exceeds 1/lev is skipped', () => {
        expect(LEV_MIX.reduce((t, x) => t + x.w, 0)).toBeCloseTo(1);
        expect(LEV_MIX.map((x) => x.lev)).toEqual([5, 8, 10, 15, 20, 25, 33, 50, 75, 100, 125]);
        const rows = estimateLiqLevels({ klines: [k(0, 99, 101, 100), k(1, 99, 101, 100), k(2, 99, 101, 100)], oiHist, price: 100, tiers: [{ lev: 250, w: 1 }] });
        expect(sum(rows, 'longUsd') + sum(rows, 'shortUsd')).toBe(0);
    });
});

describe('estimateLiqHeat', () => {
    // one-minute candles around 100 (low 99 / high 101 / close 100 -> entries 99, 100, 101); OI +200 during candle 0
    // 10x levels: long liq = entry*0.904, short = entry*1.096; the typical-price (50%) pair sits at 90.4 / 109.6
    const tiers = [{ lev: 10, w: 1 }];
    const candle = (i, o = {}) => ({ time: i * 60, open: 100, high: 101, low: 99, close: 100, ...o });
    const oiHist = [{ ts: 0, oiUsd: 1000 }, { ts: 60000, oiUsd: 1200 }];
    const heat = (candles, extra = {}) => estimateLiqHeat({ candles, oiHist, tiers, rows: 60, now: 1e9, ...extra });
    const cell = (h, c, r) => h.cells[c * h.rows + r];
    const colSum = (h, c) => { let t = 0; for (let r = 0; r < h.rows; r++) t += cell(h, c, r); return t; };
    const rowOf = (h, p) => Math.floor((p - h.priceMin) / h.priceStep);
    const arrSum = (a) => a.reduce((t, v) => t + v, 0);

    test('a level appears the column after its entry, not in the entry column', () => {
        const h = heat([0, 1, 2, 3].map((i) => candle(i)));
        expect(h.cols).toBe(4);
        expect(colSum(h, 0)).toBe(0);
        expect(colSum(h, 1)).toBeCloseTo(200); // 100 long + 100 short, smoothing preserves it
        expect(h.candles).toHaveLength(4);
    });
    test('a crossed level vanishes from the crossing column and all later ones', () => {
        // low 89 at candle 3 crosses all three long levels (89.5 / 90.4 / 91.3) but no short
        const h = heat([candle(0), candle(1), candle(2), candle(3, { low: 89 }), candle(4), candle(5)]);
        expect([1, 2, 3, 4, 5].map((c) => Math.round(colSum(h, c)))).toEqual([200, 200, 100, 100, 100]);
        // shorts need a high: 111 at candle 2 crosses all three (108.5 / 109.6 / 110.7)
        const h2 = heat([candle(0), candle(1), candle(2, { high: 111 }), candle(3)]);
        expect([1, 2, 3].map((c) => Math.round(colSum(h2, c)))).toEqual([200, 100, 100]);
    });
    test('smoothing spreads a level over its bucket and both neighbours 0.25/0.5/0.25 and preserves totals', () => {
        const h = heat([candle(0), candle(1), candle(2)], { rows: 200 });
        const r = rowOf(h, 100 * 0.904); // typical-price long, 50 USD
        const [a, b, c] = [r - 1, r, r + 1].map((x) => h.open.long[x]);
        expect(b).toBeGreaterThan(a);
        expect(b).toBeGreaterThan(c);
        expect(arrSum(h.open.long)).toBeCloseTo(100);
        expect(arrSum(h.open.short)).toBeCloseTo(100);
        expect(h.totals.longUsd).toBeCloseTo(100);
        expect(colSum(h, 2)).toBeCloseTo(200);
    });
    test('smoothing clamps at the grid edge without losing USD', () => {
        // tall wick candle pushes the grid so a level lands in row 0
        const h = heat([candle(0, { low: 90 }), candle(1, { low: 90 }), candle(2, { low: 90 })], { rows: 5 });
        expect(arrSum(h.open.long) + arrSum(h.open.short)).toBeCloseTo(h.totals.longUsd + h.totals.shortUsd - h.outOfViewUsd);
    });
    test('levels outside the grid still count in totals/outOfViewUsd but not in cells', () => {
        // entry candle 0 is far below the window (candle 1+ at ~100): its levels sit at ~9 / ~11
        const candles = [candle(0, { low: 9, high: 11, close: 10 }), candle(1), candle(2), candle(3)];
        const h = estimateLiqHeat({ candles, oiHist, tiers, rows: 60, now: 1e9, from: 60e3 });
        expect(h.cols).toBe(3);
        // the shorts (~12) were crossed by candle 1's high; only the long side is still open, and it is off-grid
        expect(h.outOfViewUsd).toBeCloseTo(100);
        expect(h.totals.longUsd).toBeCloseTo(100);
        expect(h.totals.shortUsd).toBe(0);
        expect(h.max).toBe(0);
        expect(h.open.long.every((v) => v === 0)).toBe(true);
    });
    test('grid spans window low*0.88 .. window high*1.12', () => {
        const h = heat([candle(0), candle(1)], { rows: 10 });
        expect(h.priceMin).toBeCloseTo(99 * 0.88);
        expect(h.priceMin + h.priceStep * h.rows).toBeCloseTo(101 * 1.12);
    });
    test('candles after now are dropped once, so columns and returned candles stay aligned', () => {
        const h = heat([0, 1, 2, 3].map((i) => candle(i)), { now: 120e3 });
        expect(h.cols).toBe(3);
        expect(h.candles.map((c) => c.time)).toEqual([0, 60, 120]);
    });
    test('candles before `from` only seed levels; they are not output columns', () => {
        const h = heat([0, 1, 2, 3, 4].map((i) => candle(i)), { from: 2 * 60e3 });
        expect(h.cols).toBe(3);
        expect(h.t0).toBe(120e3);
        expect(colSum(h, 0)).toBeCloseTo(200); // opened before the window, open from column 0
    });
    test('empty inputs give an empty grid without NaN', () => {
        for (const h of [estimateLiqHeat({ candles: [], oiHist: [] }), estimateLiqHeat({ candles: undefined })]) {
            expect(h.cols).toBe(0);
            expect(h.cells).toHaveLength(0);
            expect(h.max).toBe(0);
            expect(h.outOfViewUsd).toBe(0);
        }
        const flat = heat([candle(0), candle(1)], { oiHist: [] });
        expect(flat.max).toBe(0);
        expect(Array.from(flat.cells).every(Number.isFinite)).toBe(true);
    });
});

describe('liqKeyLevels', () => {
    // priceMin 0, step 10 -> bucket b is centred at 10b + 5; price 100 sits at the boundary of buckets 9 and 10
    const prof = (n, o) => { const a = new Float64Array(n); Object.entries(o).forEach(([i, v]) => { a[i] = v; }); return a; };
    const run = (long, short, n) => liqKeyLevels({ long: prof(20, long), short: prof(20, short) }, 0, 10, 100, n);

    test('takes local peaks only, nearest first, with centre price and signed pct', () => {
        const k = run({ 1: 3, 2: 9, 3: 4, 7: 5 }, { 12: 2, 13: 8, 14: 1, 17: 6 });
        expect(k.below.map((l) => l.price)).toEqual([75, 25]); // peaks at buckets 7 and 2 (1 and 3 are not peaks)
        expect(k.above.map((l) => l.price)).toEqual([135, 175]);
        expect(k.below[0]).toEqual({ price: 75, usd: 5, pct: -25 });
        expect(k.above[0].pct).toBe(35);
    });
    test('a plateau counts each bucket (>= both neighbours); edge buckets compare with the one neighbour', () => {
        const k = run({ 0: 5, 1: 2, 5: 4, 6: 4 }, { 19: 7, 18: 1 });
        expect(k.below.map((l) => l.price)).toEqual([65, 55, 5]);
        expect(k.above.map((l) => l.price)).toEqual([195]);
    });
    test('keeps the n largest per side', () => {
        const k = run({ 1: 1, 3: 5, 5: 3, 7: 4 }, {}, 2);
        expect(k.below.map((l) => l.usd).sort()).toEqual([4, 5]);
        expect(k.above).toEqual([]);
    });
    test('longs above price and shorts below price are ignored', () => {
        const k = run({ 15: 5 }, { 3: 5 });
        expect(k.above).toEqual([]);
        expect(k.below).toEqual([]);
    });
});
