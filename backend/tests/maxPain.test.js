const futuresRest = require('../services/futuresRest');
const mp = require('../services/maxPain');
const router = require('../routes/marketRoutes');

const candles = (n, step) => Array.from({ length: n }, (_, i) => ({ time: i, close: 100 * (1 + (i % 2 ? step : -step)) }));
const heat = (symbol, over = {}) => ({
    symbol, price: 100, colMs: 300e3, candles: candles(60, 0.001),
    keyLevels: { above: [{ price: 101, usd: 10 }, { price: 105, usd: 50 }], below: [{ price: 99, usd: 5 }, { price: 90, usd: 20 }] },
    totals: { longUsd: 25, shortUsd: 60 }, ...over,
});
const ov = (n) => Array.from({ length: n }, (_, i) => ({ symbol: `C${i}USDT`, quoteVolume: 1000 - i }));

beforeEach(() => mp._test.reset());
afterEach(() => jest.restoreAllMocks());

test('normCdf and touch probability math', () => {
    expect(mp.normCdf(0)).toBeCloseTo(0.5, 6);
    expect(mp.normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(mp.normCdf(-1)).toBeCloseTo(0.1587, 3);
    const t = mp.touchStats(100, 100 * Math.exp(0.02), 0.02); // exactly 1 sigma away
    expect(t.sigma).toBe(1);
    expect(t.touchPct).toBeCloseTo(31.7, 0); // 2 * (1 - Phi(1))
    expect(mp.touchStats(100, 90, 0)).toEqual({ sigma: null, touchPct: null });
});

test('windowSigma scales by sqrt(window / candle) and needs history', () => {
    const c = candles(40, 0.001);
    const a = mp.windowSigma(c, 300e3, 300e3);
    expect(mp.windowSigma(c, 300e3, 4 * 300e3)).toBeCloseTo(2 * a, 9);
    expect(mp.windowSigma(candles(5, 0.001), 300e3, 300e3)).toBeNull();
    expect(mp.windowSigma(candles(40, 0), 300e3, 300e3)).toBeNull();
});

test('aggregates strongest level per side, caps N at 30, counts skipped symbols', async () => {
    jest.spyOn(futuresRest, 'overview').mockResolvedValue(ov(40));
    const lh = jest.spyOn(futuresRest, 'liqheat').mockImplementation(async (s) => {
        if (s === 'C1USDT') throw new Error('boom');
        if (s === 'C2USDT') return heat(s, { keyLevels: { above: [], below: [] } });
        return heat(s);
    });
    const r = await mp.maxPain('24h', 99);
    expect(r.top).toBe(30);
    expect(lh).toHaveBeenCalledTimes(30);
    expect(r.skipped).toBe(2);
    expect(r.count).toBe(28);
    expect(r.confluence).toBe('omitted');
    const row = r.rows[0];
    expect(row.symbol).toBe('C0USDT');
    expect(row.above).toMatchObject({ price: 105, usd: 50, pct: 5 });
    expect(row.below).toMatchObject({ price: 90, usd: 20, pct: -10 });
    expect(row.above.sigma).toBeGreaterThan(0);
    expect(row.above.touchPct).toBeLessThan(100);
});

test('bounded concurrency', async () => {
    jest.spyOn(futuresRest, 'overview').mockResolvedValue(ov(12));
    let live = 0; let peak = 0;
    jest.spyOn(futuresRest, 'liqheat').mockImplementation(async (s) => {
        live++; peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live--; return heat(s);
    });
    await mp.maxPain('24h', 12);
    expect(peak).toBeLessThanOrEqual(4);
});

test('60 s cache; stale-while-revalidate serves old data once and refreshes once; total failure with no data throws', async () => {
    jest.spyOn(futuresRest, 'overview').mockResolvedValue(ov(3));
    const lh = jest.spyOn(futuresRest, 'liqheat').mockImplementation(async (s) => heat(s));
    const now = jest.spyOn(Date, 'now');
    const t0 = 1e12;
    now.mockReturnValue(t0);
    await mp.maxPain('24h', 3);
    await mp.maxPain('24h', 3);
    expect(lh).toHaveBeenCalledTimes(3); // second call is a cache hit
    now.mockReturnValue(t0 + 61e3);
    const s = await mp.maxPain('24h', 3);
    expect(s.stale).toBe(true);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(lh).toHaveBeenCalledTimes(6);
    const fresh = await mp.maxPain('24h', 3);
    expect(fresh.stale).toBeUndefined();
    mp._test.reset();
    lh.mockRejectedValue(new Error('down'));
    await expect(mp.maxPain('24h', 3)).rejects.toThrow();
});

test('route validates window and top, and serves the aggregate', async () => {
    const layer = router.stack.find((l) => l.route && l.route.path === '/futures/maxpain');
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const run = async (query) => {
        const res = { set() { return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await handler({ query }, res);
        return res;
    };
    expect((await run({ window: '9y' })).code).toBe(400);
    expect((await run({ top: '31' })).code).toBe(400);
    expect((await run({ top: '0' })).code).toBe(400);
    jest.spyOn(futuresRest, 'overview').mockResolvedValue(ov(2));
    jest.spyOn(futuresRest, 'liqheat').mockImplementation(async (s) => heat(s));
    const ok = await run({ window: '3d', top: '2' });
    expect(ok.body.count).toBe(2);
    expect(ok.body.window).toBe('3d');
});
