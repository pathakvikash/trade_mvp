const axios = require('axios');
const rest = require('../services/futuresRest');
const { cvdSeries } = require('../services/cvd');
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
    const run = async (query = {}, symbol = 'BTCUSDT') => {
        const layer = router.stack.find((l) => l.route && l.route.path === '/futures/cvd/:symbol');
        const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await layer.route.stack[0].handle({ params: { symbol }, query }, res);
        return res;
    };
    const known = () => jest.spyOn(rest, 'isKnownSymbol').mockResolvedValue(true);

    test('real taker volume -> candles with running cvd, source binance-futures', async () => {
        known();
        const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: [row(60, 10, 10, 7), row(120, 11, 10, 2)] });
        const r = await run({ range: '6h' });
        expect(get.mock.calls[0][1].params).toMatchObject({ symbol: 'BTCUSDT', interval: '5m', limit: 72 });
        expect(r.body).toMatchObject({ available: true, interval: '5m', source: 'binance-futures' });
        expect(r.body.candles.map((c) => c.cvd)).toEqual([4, -2]);
        expect(r.headers['X-Data-Source']).toBe('binance-futures');
    });

    test('Binance blocked -> 200 available:false, no candles, nothing approximated from another source', async () => {
        known();
        const get = jest.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('blocked'), { response: { status: 451 } }));
        const r = await run({});
        expect(r.code).toBeUndefined();
        expect(r.body).toMatchObject({ available: false, source: 'unavailable', range: '24h' });
        expect(r.body.candles).toBeUndefined();
        expect(get.mock.calls.every(([u]) => !u.includes('binance.vision'))).toBe(true);
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
