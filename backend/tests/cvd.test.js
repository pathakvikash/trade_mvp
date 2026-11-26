const axios = require('axios');
const rest = require('../services/futuresRest');
const { cvdSeries } = require('../services/cvd');
const cvdService = require('../services/cvd');
const router = require('../routes/marketRoutes');

// Binance kline row: [openTime, o, h, l, close, volume, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote]
const row = (t, close, vol, buy) => [t * 1000, '1', '2', '0.5', String(close), String(vol), t * 1000 + 1, '0', 1, String(buy), '0'];

beforeEach(() => rest._test.reset());
afterEach(() => jest.restoreAllMocks());

test('cvdSeries: delta = buy - sell, cumulative from the first candle; unusable rows dropped', () => {
    const c = cvdSeries([row(60, 10, 10, 7), row(120, 11, 4, 1), ['x'], row(180, 12, 5, 9), row(240, 13, 2, 1)]);
    expect(c.map((x) => x.delta)).toEqual([4, -2, 0]); // buy>vol row skipped; vol 2 buy 1 -> 0
    expect(c.map((x) => x.cvd)).toEqual([4, 2, 2]);
    expect(c[0]).toMatchObject({ time: 60, close: 10, buy: 7, sell: 3 });
});

describe('/futures/cvd/:symbol', () => {
    const run = async (query = {}, symbol = 'BTCUSDT', path = '/futures/cvd/:symbol') => {
        const layer = router.stack.find((l) => l.route && l.route.path === path);
        const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await layer.route.stack[0].handle({ params: { symbol }, query }, res);
        return res;
    };
    const known = () => jest.spyOn(rest, 'isKnownSymbol').mockResolvedValue(true);

    test('real taker volume -> candles with running cvd, source binance-futures', async () => {
        known();
        const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: [row(60, 10, 10, 7), row(120, 11, 10, 2)] });
        const r = await run({ range: '6h' });
        expect(get.mock.calls.find(([u]) => u.includes('fapi'))[1].params).toMatchObject({ symbol: 'BTCUSDT', interval: '5m', limit: 72 });
        expect(r.body).toMatchObject({ available: true, interval: '5m', source: 'binance-futures' });
        expect(r.body.candles.map((c) => c.cvd)).toEqual([4, -2]);
        expect(r.headers['X-Data-Source']).toBe('binance-futures');
    });

    test('Binance blocked -> 200 available:false, no candles, spot also unavailable, nothing approximated', async () => {
        known();
        jest.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('blocked'), { response: { status: 451 } }));
        const r = await run({});
        expect(r.code).toBeUndefined();
        expect(r.body).toMatchObject({ available: false, source: 'unavailable', range: '24h', spot: { available: false, source: 'unavailable' } });
        expect(r.body.candles).toBeUndefined();
        expect(r.body.spot.candles).toBeUndefined();
    });

    test('interval param -> that interval and count; spot series from spot klines with its own cvd; spot down leaves futures intact', async () => {
        known();
        const get = jest.spyOn(axios, 'get').mockImplementation((u) => (u.includes('fapi')
            ? Promise.resolve({ data: [row(60, 10, 10, 7)] })
            : Promise.resolve({ data: [row(60, 10, 8, 2), row(120, 11, 8, 6)] })));
        const r = await run({ interval: '1h' });
        expect(get.mock.calls.find(([u]) => u.includes('fapi'))[1].params).toMatchObject({ interval: '1h', limit: 168 });
        expect(get.mock.calls.find(([u]) => !u.includes('fapi'))[1].params).toMatchObject({ interval: '1h', limit: 168 });
        expect(r.body).toMatchObject({ available: true, interval: '1h', range: null });
        expect(r.body.candles.map((c) => c.cvd)).toEqual([4]);
        expect(r.body.spot).toMatchObject({ available: true, source: 'binance-spot' });
        expect(r.body.spot.candles.map((c) => c.cvd)).toEqual([-4, -4 + 4]); // 2 of 8 bought -> -4; 6 of 8 -> +4
        expect(r.body.candles[0]).toMatchObject({ open: 1, high: 2, low: 0.5, volume: 10 });
    });

    test('spot unreachable -> futures still served, spot says why', async () => {
        known();
        jest.spyOn(axios, 'get').mockImplementation((u) => (u.includes('fapi') ? Promise.resolve({ data: [row(60, 10, 10, 7)] }) : Promise.reject(Object.assign(new Error('x'), { response: { status: 400 } }))));
        const r = await run({ interval: '5m' });
        expect(r.body.available).toBe(true);
        expect(r.body.spot).toMatchObject({ available: false, reason: 'No Binance spot market for this symbol.' });
    });

    test('bad interval -> 400', async () => {
        known();
        expect((await run({ interval: '2m' })).code).toBe(400);
    });

    test('bad range / symbol -> 400; unknown market -> 404; empty klines -> 502', async () => {
        known();
        expect((await run({ range: '9y' })).code).toBe(400);
        expect((await run({}, 'bad')).code).toBe(400);
        jest.spyOn(axios, 'get').mockResolvedValue({ data: [] });
        expect((await run({})).code).toBe(502);
        rest.isKnownSymbol.mockResolvedValue(false);
        expect((await run({})).code).toBe(404);
    });
});

describe('/futures/cvd/:symbol/trades', () => {
    const P = '/futures/cvd/:symbol/trades';
    const run = async (query = {}, symbol = 'BTCUSDT') => {
        const layer = router.stack.find((l) => l.route && l.route.path === P);
        const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await layer.route.stack[0].handle({ params: { symbol }, query }, res);
        return res;
    };
    const agg = (a, usd, m, ago) => ({ a, p: '100', q: String(usd / 100), T: Date.now() - ago, m });

    test('taker side from m, threshold filter newest first, 60 s flow counts only the last minute', async () => {
        jest.spyOn(rest, 'isKnownSymbol').mockResolvedValue(true);
        jest.spyOn(axios, 'get').mockResolvedValue({ data: [agg(1, 60000, false, 120000), agg(2, 20000, true, 30000), agg(3, 70000, false, 20000), agg(4, 5000, true, 10000)] });
        const r = await run({ min: '50000' });
        expect(r.body.items.map((t) => [t.id, t.side])).toEqual([[3, 'buy'], [1, 'buy']]);
        expect(r.body.flow60).toMatchObject({ buyUsd: 70000, sellUsd: 25000, netUsd: 45000, trades: 3 });
        expect(r.body.flow60.coveredMs).toBe(60000);
        expect((await run({ min: '12345' })).code).toBe(400);
    });

    test('perMin buckets large trades per clock minute by taker side; window, count and median are reported', async () => {
        const { perMinute } = require('../services/cvd');
        const now = Date.UTC(2026, 0, 1, 12, 10, 30);
        const t = (usd, side, ago) => ({ usd, side, ts: now - ago });
        const out = perMinute([t(60000, 'buy', 1000), t(70000, 'sell', 5000), t(10, 'buy', 1000), t(90000, 'buy', 75000), t(90000, 'buy', 20 * 60000)], 50000, now, 15);
        expect(out).toHaveLength(15);
        expect(out[14]).toMatchObject({ buyUsd: 60000, sellUsd: 70000, n: 2 }); // 12:10
        expect(out[13]).toMatchObject({ buyUsd: 90000, n: 1 }); // 12:09 (75 s before 12:10:30)
        expect(out[0].n).toBe(0); // the 20 min old print is outside the 15 min
        expect(out[14].t).toBe(Date.UTC(2026, 0, 1, 12, 10));
        jest.spyOn(rest, 'isKnownSymbol').mockResolvedValue(true);
        jest.spyOn(axios, 'get').mockResolvedValue({ data: [agg(11, 60000, false, 90000), agg(12, 2000, true, 30000), agg(13, 80000, true, 10000)] });
        const r = await run({ min: '50000' }, 'ETHUSDT'); // other symbol: own cache entry
        expect(r.body).toMatchObject({ count: 3, medianUsd: 60000 });
        expect(r.body.windowMs).toBeGreaterThanOrEqual(90000);
        expect(r.body.perMin).toHaveLength(15);
        expect(r.body.perMin.reduce((n, m) => n + m.n, 0)).toBe(2);
        expect(r.body.items.every((i) => Number.isInteger(i.id))).toBe(true); // stable React keys
    });

    test('blocked -> available:false with a reason, no items', async () => {
        jest.spyOn(rest, 'isKnownSymbol').mockResolvedValue(true);
        jest.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('blocked'), { response: { status: 451 } }));
        const r = await run({});
        expect(r.body).toMatchObject({ available: false });
        expect(r.body.items).toBeUndefined();
    });
});
