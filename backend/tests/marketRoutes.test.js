const router = require('../routes/marketRoutes');

test('/api/market is limited to 120 requests/min per IP: 429 rate_limited + Retry-After', () => {
    const limiter = router.stack[0].handle; // router.use(limitBy(...)) is registered first, so it covers every route
    const hit = (ip) => {
        const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        const next = jest.fn();
        limiter({ ip }, res, next);
        return { res, next };
    };
    for (let i = 0; i < 120; i++) expect(hit('1.1.1.1').next).toHaveBeenCalled();
    const { res, next } = hit('1.1.1.1');
    expect(next).not.toHaveBeenCalled();
    expect(res.code).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(hit('2.2.2.2').next).toHaveBeenCalled(); // other IPs unaffected
});

describe('data-source header and blocked liqmap', () => {
    const futuresRest = require('../services/futuresRest');
    const run = async (path, url) => {
        const layer = router.stack.find((l) => l.route && l.route.path === path);
        const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await layer.route.stack[0].handle({ params: { symbol: 'BTCUSDT' }, query: {} }, res);
        return res;
    };
    afterEach(() => jest.restoreAllMocks());

    test('overview/klines/symbols set X-Data-Source (binance-futures unless the rows say otherwise)', async () => {
        const ws = Object.defineProperty([{ symbol: 'A' }], 'source', { value: 'ws' });
        jest.spyOn(futuresRest, 'overview').mockResolvedValueOnce(ws).mockResolvedValueOnce([]);
        expect((await run('/futures/overview')).headers['X-Data-Source']).toBe('ws');
        expect((await run('/futures/overview')).headers['X-Data-Source']).toBe('binance-futures');
        jest.spyOn(futuresRest, 'listSymbols').mockResolvedValue(Object.defineProperty([], 'source', { value: 'ws' }));
        expect((await run('/futures/symbols')).headers['X-Data-Source']).toBe('ws');
        jest.spyOn(futuresRest, 'isKnownSymbol').mockResolvedValue(true);
        jest.spyOn(futuresRest, 'klines').mockResolvedValue(Object.defineProperty([], 'source', { value: 'spot' }));
        expect((await run('/futures/klines/:symbol')).headers['X-Data-Source']).toBe('spot');
    });

    test('blocked liqmap -> 503 degraded; a plain upstream failure stays 502', async () => {
        jest.spyOn(futuresRest, 'isKnownSymbol').mockResolvedValue(true);
        const liq = jest.spyOn(futuresRest, 'liqmap').mockRejectedValue(Object.assign(new Error('binance rest blocked'), { blocked: true }));
        const r = await run('/futures/liqmap/:symbol');
        expect(r.code).toBe(503);
        expect(r.body).toEqual({ error: 'Binance futures data is unavailable from this server', degraded: true });
        liq.mockRejectedValue(Object.assign(new Error('HTTP 451'), { response: { status: 451 } })); // the call that trips on 451
        expect((await run('/futures/liqmap/:symbol')).code).toBe(503);
        liq.mockRejectedValue(new Error('boom'));
        expect((await run('/futures/liqmap/:symbol')).code).toBe(502);
    });
});
