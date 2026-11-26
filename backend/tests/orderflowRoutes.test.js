jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
const router = require('../routes/orderflowRoutes');
const collector = require('../services/orderflow/collector');
const futuresRest = require('../services/futuresRest');

const call = async (path, symbol, ip = '1.1.1.1') => {
    const res = { headers: {}, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    const limiter = router.stack[0].handle;
    let passed = false;
    limiter({ ip }, res, () => { passed = true; });
    if (!passed) return res;
    await router.stack.find((l) => l.route && l.route.path === path).route.stack[0].handle({ params: { symbol } }, res);
    return res;
};
beforeEach(() => jest.spyOn(futuresRest, 'isKnownSymbol').mockImplementation(async (s) => s !== 'FAKEUSDT'));
afterEach(() => jest.restoreAllMocks());

test('400 on a bad symbol, 404 no_futures for one not in the futures list (collector untouched), 503 when busy', async () => {
    expect((await call('/heatmap/:symbol', 'btc!')).code).toBe(400);
    const spy = jest.spyOn(collector, 'large');
    const r = await call('/large/:symbol', 'FAKEUSDT');
    expect(r.code).toBe(404);
    expect(r.body.error).toBe('no_futures');
    expect(spy).not.toHaveBeenCalled();
    jest.spyOn(collector, 'heatmap').mockReturnValue({ status: 'collecting' });
    expect((await call('/heatmap/:symbol', 'MANTRAUSDT')).code).toBe(200); // not in the old whitelist
    jest.spyOn(collector, 'heatmap').mockReturnValue({ error: 'busy' });
    expect((await call('/heatmap/:symbol', 'BTCUSDT')).code).toBe(503);
});

test('200 sets X-Data-Source; unavailable is 503 degraded', async () => {
    jest.spyOn(collector, 'heatmap').mockReturnValue({ status: 'ok', source: 'bybit', cols: 1 });
    const ok = await call('/heatmap/:symbol', 'BTCUSDT');
    expect(ok.code).toBe(200);
    expect(ok.headers['X-Data-Source']).toBe('bybit');
    jest.spyOn(collector, 'large').mockReturnValue({ status: 'unavailable', source: null });
    const bad = await call('/large/:symbol', 'BTCUSDT');
    expect(bad.code).toBe(503);
    expect(bad.body.degraded).toBe(true);
});

test('rate limited to 40/min per IP', async () => {
    jest.spyOn(collector, 'large').mockReturnValue({ status: 'ok' });
    for (let i = 0; i < 40; i++) expect((await call('/large/:symbol', 'BTCUSDT', '9.9.9.9')).code).toBe(200);
    const r = await call('/large/:symbol', 'BTCUSDT', '9.9.9.9');
    expect(r.code).toBe(429);
    expect(r.body).toEqual({ error: 'rate_limited' });
    expect((await call('/large/:symbol', 'BTCUSDT', '8.8.8.8')).code).toBe(200);
});

test('mounted under /orderflow in the market router (after its own limiter)', () => {
    const m = require('../routes/marketRoutes');
    expect(m.stack.some((l) => l.name === 'router' && String(l.regexp || l.matchers?.[0]?.name || '').includes('orderflow') || l.handle === router)).toBe(true);
});
