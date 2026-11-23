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

    test('stats/liqmap/liqheat objects set X-Data-Source from their source (own or non-enumerable)', async () => {
        jest.spyOn(futuresRest, 'isKnownSymbol').mockResolvedValue(true);
        jest.spyOn(futuresRest, 'stats').mockResolvedValue({ symbol: 'BTCUSDT', source: 'bybit' });
        jest.spyOn(futuresRest, 'liqmap').mockResolvedValue(Object.defineProperty({ levels: [] }, 'source', { value: 'bybit', enumerable: false }));
        jest.spyOn(futuresRest, 'liqheat').mockResolvedValue({ cols: 1 });
        const req = (p) => run(p);
        expect((await req('/futures/stats/:symbol')).headers['X-Data-Source']).toBe('bybit');
        const m = await req('/futures/liqmap/:symbol');
        expect(m.headers['X-Data-Source']).toBe('bybit');
        expect(JSON.stringify(m.body)).not.toContain('bybit');
        expect((await req('/futures/liqheat/:symbol')).headers['X-Data-Source']).toBeUndefined();
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

describe('curated Yahoo markets routes', () => {
    const axios = require('axios');
    const yahoo = require('../services/marketData/providers/yahoo');
    const nowS = () => Math.floor(Date.now() / 1000);
    const meta = () => ({ regularMarketPrice: 25000, regularMarketChangePercent: 0.4, regularMarketTime: nowS(), currentTradingPeriod: { regular: { start: nowS() - 10, end: nowS() + 10 } } });
    const call = async (path, req) => {
        const layer = router.stack.find((l) => l.route && l.route.path === path);
        const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        await layer.route.stack[0].handle({ params: {}, query: {}, ...req }, res);
        return res;
    };
    beforeEach(() => yahoo._test.reset());
    afterEach(() => jest.restoreAllMocks());

    test('instruments/quotes: disclaimer, X-Data-Source, per-row category/currency/exchange; stocks route is stock only', async () => {
        jest.spyOn(axios, 'get').mockImplementation(async (url) => ({ data: { spark: { result: [{ symbol: '^NSEI', response: [{ meta: meta() }] }, { symbol: 'RELIANCE.NS', response: [{ meta: meta() }] }] } } }));
        const idx = await call('/instruments/quotes', { query: { category: 'index' } });
        expect(idx.code).toBeUndefined();
        expect(idx.headers['X-Data-Source']).toBe('yahoo');
        expect(idx.body.disclaimer).toMatch(/view only/);
        expect(idx.body.rows[0]).toEqual(expect.objectContaining({ symbol: 'NIFTY50', category: 'index', exchange: 'NSE', currency: 'INR', marketOpen: true }));
        const st = await call('/stocks/quotes', {});
        expect(st.body.rows.every((r) => r.category === 'stock')).toBe(true);
        expect(JSON.stringify(idx.body)).not.toContain('^NSEI');
    });

    test('bad category 400; Yahoo 429 with no cache -> 502 Market data unavailable', async () => {
        expect((await call('/instruments/quotes', { query: { category: 'crypto' } })).code).toBe(400);
        jest.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('x'), { response: { status: 429, headers: {} } }));
        const r = await call('/instruments/quotes', {});
        expect(r.code).toBe(502);
        expect(r.body).toEqual({ error: 'Market data unavailable' });
    });

    test('klines: unknown symbol 404, raw Yahoo ticker 400, 4h 400, stocks route rejects non-stock, ok path encodes ticker', async () => {
        const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { chart: { result: [{ meta: meta(), timestamp: [nowS()], indicators: { quote: [{ open: [1], high: [2], low: [1], close: [2], volume: [5] }] } }] } } });
        expect((await call('/instruments/klines/:symbol', { params: { symbol: 'NOPE' } })).code).toBe(404);
        for (const raw of ['^NSEI', 'GC=F', 'RELIANCE.NS']) expect((await call('/instruments/klines/:symbol', { params: { symbol: raw } })).code).toBe(400);
        expect((await call('/instruments/klines/:symbol', { params: { symbol: 'GOLD' }, query: { interval: '4h' } })).code).toBe(400);
        expect((await call('/stocks/klines/:symbol', { params: { symbol: 'GOLD' } })).code).toBe(404);
        expect(get).not.toHaveBeenCalled();
        const ok = await call('/instruments/klines/:symbol', { params: { symbol: 'gold' }, query: { interval: '1d' } });
        expect(ok.body).toEqual(expect.objectContaining({ symbol: 'GOLD', category: 'commodity', currency: 'USD', candles: [expect.objectContaining({ close: 2 })] }));
        expect(get.mock.calls[0][0]).toContain('GC%3DF');
    });

    test('/providers: {providers:[...]} with yahoo, no http string, survives a missing or throwing gateway module', async () => {
        const r = await call('/providers', {});
        expect(r.body.providers.find((p) => p.name === 'yahoo')).toBeTruthy();
        expect(JSON.stringify(r.body)).not.toMatch(/http/i);
        // a gateway whose health() throws must not take the route down: yahoo only
        jest.spyOn(require('../services/marketData'), 'health').mockImplementation(() => { throw new Error('gateway broke'); });
        const r2 = await call('/providers', {});
        expect(r2.code).toBeUndefined();
        expect(r2.body.providers.map((p) => p.name)).toEqual(['yahoo']);
    });
});
