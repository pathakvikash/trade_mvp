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
