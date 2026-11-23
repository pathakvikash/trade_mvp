// /api/strategies routes, dispatched in-process through the real router (no sockets, no DB, no network).
// auth is mounted in server.js, so here req.user is set the way the JWT middleware would.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ isKnownSymbol: jest.fn(async () => true), klines: jest.fn() }));
jest.mock('../services/marketData/providers/yahoo', () => ({ klines: jest.fn(), INTERVALS: { '1h': 1, '1d': 1 } }));
jest.mock('../models/Strategy', () => {
    const { Types } = require('mongoose');
    const rows = [];
    const match = (r, f) => Object.entries(f).every(([k, v]) => String(r[k]) === String(v));
    const q = (get) => { const o = { sort: () => o, lean: () => o, then: (ok, ko) => Promise.resolve().then(get).then(ok, ko) }; return o; };
    return {
        __rows: rows,
        find: (f) => q(() => rows.filter((r) => match(r, f)).map((r) => ({ ...r }))),
        findOne: (f) => q(() => { const r = rows.find((x) => match(x, f)); return r ? { ...r } : null; }),
        countDocuments: async (f) => rows.filter((r) => match(r, f)).length,
        create: async (d) => { const r = { _id: new Types.ObjectId(), ...d }; rows.push(r); return { toObject: () => ({ ...r }) }; },
        findOneAndUpdate: (f, u) => q(() => { const r = rows.find((x) => match(x, f)); if (r) Object.assign(r, u.$set); return r ? { ...r } : null; }),
        deleteOne: async (f) => { const i = rows.findIndex((x) => match(x, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
        deleteMany: async () => {},
    };
});

const mongoose = require('mongoose');
const Strategy = require('../models/Strategy');
const futuresRest = require('../services/futuresRest');
const yahoo = require('../services/marketData/providers/yahoo');
const router = require('../routes/strategyRoutes');

const oid = () => String(new mongoose.Types.ObjectId());
const A = oid();
const B = oid();

// Runs the whole router chain for one route; resolves with { status, body }.
const call = (method, path, { user = A, body = {}, params = {} } = {}) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const req = { method: method.toUpperCase(), headers: {}, body, params, user: { userId: user }, ip: '127.0.0.1' };
    return new Promise((resolve, reject) => {
        const res = { statusCode: 200, headers: {}, status(c) { this.statusCode = c; return this; }, set(k, v) { this.headers[k] = v; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
        const step = (i) => (err) => {
            if (err) return reject(err);
            const l = layer.route.stack[i];
            if (!l) return reject(new Error('no response'));
            Promise.resolve(l.handle(req, res, step(i + 1))).catch(reject);
        };
        step(0)();
    });
};

const SPEC = {
    version: 1, name: 'ema cross', timeframe: '1h', direction: 'long',
    indicators: [{ id: 'fast', type: 'ema', source: 'close', period: 3 }, { id: 'slow', type: 'ema', source: 'close', period: 8 }],
    entry: { long: { all: [{ left: 'fast', op: 'crosses_above', right: 'slow' }] } },
    exit: { long: { any: [{ left: 'fast', op: 'crosses_below', right: 'slow' }] } },
    risk: { stopPct: 2, targetPct: 4 }, plot: ['fast', 'slow'],
};
const candles = (n = 60) => Array.from({ length: n }, (_, i) => {
    const c = 100 + 10 * Math.sin(i / 4);
    return { time: 1.6e9 + i * 3600, open: c, high: c + 1, low: c - 1, close: c, volume: 10 };
});
const EVAL = { kind: 'perp', symbol: 'BTCUSDT', interval: '1h', limit: 100 };

beforeEach(() => {
    Strategy.__rows.length = 0;
    futuresRest.klines.mockReset().mockResolvedValue(candles());
    yahoo.klines.mockReset().mockResolvedValue({ candles: candles() });
});

describe('validate', () => {
    test('valid spec -> 200 with parsed spec and describe', async () => {
        const r = await call('post', '/validate', { body: { spec: SPEC } });
        expect(r.status).toBe(200);
        expect(r.body.spec.name).toBe('ema cross');
        expect(typeof r.body.describe).toBe('string');
    });
    test('invalid spec -> 422 with paths and no echo of the input', async () => {
        const r = await call('post', '/validate', { body: { spec: { ...SPEC, code: "fetch('//evil.example')" } } });
        expect(r.status).toBe(422);
        expect(r.body.error).toBe('invalid_spec');
        expect(r.body.issues.length).toBeGreaterThan(0);
        expect(r.body.issues[0]).toHaveProperty('path');
        expect(JSON.stringify(r.body)).not.toContain('evil.example');
    });
    test('missing spec -> 400', async () => {
        expect((await call('post', '/validate', { body: {} })).status).toBe(400);
    });
    test('60/min per user then 429', async () => {
        let last;
        for (let i = 0; i < 61; i++) last = await call('post', '/validate', { user: oid(), body: { spec: SPEC } }); // fresh user: not limited
        expect(last.status).toBe(200);
        const u = oid();
        for (let i = 0; i < 60; i++) expect((await call('post', '/validate', { user: u, body: { spec: SPEC } })).status).toBe(200);
        expect((await call('post', '/validate', { user: u, body: { spec: SPEC } })).status).toBe(429);
    });
});

describe('CRUD', () => {
    const create = (user = A, extra = {}) => call('post', '/', { user, body: { spec: SPEC, ...extra } });

    test('create stores the parsed spec, hash and defaults; list is per user', async () => {
        const r = await create(A, { symbol: 'btcusdt', origin: 'ai' });
        expect(r.status).toBe(201);
        expect(r.body).toMatchObject({ name: 'ema cross', symbol: 'BTCUSDT', origin: 'ai' });
        expect(r.body.specHash).toMatch(/^[a-f0-9]{64}$/);
        await create(B);
        const list = await call('get', '/');
        expect(list.body).toHaveLength(1);
        expect(String(list.body[0].userId)).toBe(A);
    });
    test('the hash ignores key order', async () => {
        const reordered = Object.fromEntries(Object.entries(SPEC).reverse());
        const [x, y] = [await create(), await call('post', '/', { body: { spec: reordered } })];
        expect(x.body.specHash).toBe(y.body.specHash);
    });
    test('invalid spec -> 422, unknown body field / userId in body -> 400, nothing stored', async () => {
        expect((await call('post', '/', { body: { spec: { ...SPEC, indicators: [] } } })).status).toBe(422);
        expect((await call('post', '/', { body: { spec: SPEC, userId: B } })).status).toBe(400);
        expect((await call('post', '/', { body: { name: 'x' } })).status).toBe(400);
        expect(Strategy.__rows).toHaveLength(0);
    });
    test('cap 20: the 21st is 409 STRATEGY_LIMIT, another user is unaffected', async () => {
        for (let i = 0; i < 20; i++) expect((await create()).status).toBe(201);
        const r = await create();
        expect(r).toMatchObject({ status: 409, body: { error: 'STRATEGY_LIMIT' } });
        expect((await create(B)).status).toBe(201);
    });
    test('foreign id is 404 (never 403) on GET, PUT, DELETE; the row is untouched', async () => {
        const { body: mine } = await create(A);
        const id = String(mine._id);
        expect((await call('get', '/:id', { user: B, params: { id } })).status).toBe(404);
        expect((await call('put', '/:id', { user: B, params: { id }, body: { name: 'hijack' } })).status).toBe(404);
        expect((await call('delete', '/:id', { user: B, params: { id } })).status).toBe(404);
        expect(Strategy.__rows[0].name).toBe('ema cross');
        expect((await call('get', '/:id', { params: { id } })).status).toBe(200);
        expect((await call('get', '/:id', { params: { id: oid() } })).status).toBe(404);
    });
    test('non-ObjectId ids are 404', async () => {
        for (const id of ['abc', '{"$ne":1}', '123']) {
            expect((await call('get', '/:id', { params: { id } })).status).toBe(404);
            expect((await call('delete', '/:id', { params: { id } })).status).toBe(404);
        }
    });
    test('PUT re-parses a new spec and refreshes the hash; delete removes', async () => {
        const { body: mine } = await create();
        const id = String(mine._id);
        const bad = await call('put', '/:id', { params: { id }, body: { spec: { ...SPEC, version: 2 } } });
        expect(bad.status).toBe(422);
        const next = { ...SPEC, name: 'v2' };
        const ok = await call('put', '/:id', { params: { id }, body: { spec: next } });
        expect(ok.status).toBe(200);
        expect(ok.body.specHash).not.toBe(mine.specHash);
        expect((await call('delete', '/:id', { params: { id } })).body).toEqual({ ok: true });
        expect(Strategy.__rows).toHaveLength(0);
    });
});

describe('evaluate', () => {
    const ev = (body, user = A) => call('post', '/evaluate', { user, body });

    test('perp: server fetches klines itself; client candles are rejected and never used', async () => {
        const r = await ev({ ...EVAL, spec: SPEC });
        expect(r.status).toBe(200);
        expect(futuresRest.klines).toHaveBeenCalledWith('BTCUSDT', '1h', 100);
        expect(r.body).toEqual(expect.objectContaining({ series: expect.any(Object), markers: expect.any(Array), trades: expect.any(Array), stats: expect.any(Object), caveats: expect.any(Array), candlesSource: 'binance-futures' }));
        expect(r.body.evaluatedThrough).toBe(candles()[59].time);
        const evil = await ev({ ...EVAL, spec: SPEC, candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }] });
        expect(evil.status).toBe(400);
    });
    test('candlesSource comes from the klines source tag', async () => {
        const rows = candles();
        Object.defineProperty(rows, 'source', { value: 'bybit', enumerable: false });
        futuresRest.klines.mockResolvedValue(rows);
        expect((await ev({ ...EVAL, spec: SPEC })).body.candlesSource).toBe('bybit');
    });
    test('instrument: uses the yahoo provider with the allow-listed instrument; unknown symbol 404', async () => {
        const r = await ev({ kind: 'instrument', symbol: 'nifty50', interval: '1h', limit: 50, spec: SPEC });
        expect(r.status).toBe(200);
        expect(yahoo.klines).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'NIFTY50', yahoo: expect.anything() }), '1h', 50);
        expect(r.body.candlesSource).toBe('yahoo');
        expect((await ev({ kind: 'instrument', symbol: 'NOPE', interval: '1h', spec: SPEC })).status).toBe(404);
        expect((await ev({ kind: 'instrument', symbol: 'NIFTY50', interval: '1h', spec: { ...SPEC, timeframe: '4h' } })).status).toBe(400); // yahoo has no 4h
    });
    test('the spec timeframe is the candle interval; a mismatching or junk client interval is ignored', async () => {
        for (const interval of ['1d', '9m', undefined]) {
            futuresRest.klines.mockClear();
            expect((await ev({ ...EVAL, interval, spec: SPEC })).status).toBe(200);
            expect(futuresRest.klines).toHaveBeenCalledWith('BTCUSDT', '1h', 100);
        }
        futuresRest.klines.mockClear();
        await ev({ ...EVAL, interval: '1h', spec: { ...SPEC, timeframe: '4h' } });
        expect(futuresRest.klines).toHaveBeenCalledWith('BTCUSDT', '4h', 100);
        yahoo.klines.mockClear();
        await ev({ kind: 'instrument', symbol: 'NIFTY50', interval: '1d', spec: SPEC });
        expect(yahoo.klines).toHaveBeenCalledWith(expect.anything(), '1h', 500);
    });
    test('limit > 1000, bad kind, bad symbol, bad slippage, both/neither of spec+strategyId -> 400', async () => {
        for (const patch of [{ limit: 1001 }, { limit: 0 }, { limit: '5' }, { kind: 'x' }, { symbol: 'btc/usdt' }, { interval: 5 }, { costs: { slippagePct: 2 } }, { costs: { feePct: 0 } }]) {
            expect((await ev({ ...EVAL, spec: SPEC, ...patch })).status).toBe(400);
        }
        expect((await ev({ ...EVAL })).status).toBe(400);
        expect((await ev({ ...EVAL, spec: SPEC, strategyId: oid() })).status).toBe(400);
        expect(futuresRest.klines).not.toHaveBeenCalled();
    });
    test('unknown perp symbol -> 404 without fetching', async () => {
        futuresRest.isKnownSymbol.mockResolvedValueOnce(false);
        expect((await ev({ ...EVAL, symbol: 'NOPEUSDT', spec: SPEC })).status).toBe(404);
        expect(futuresRest.klines).not.toHaveBeenCalled();
    });
    test('invalid spec -> 422 before any upstream call', async () => {
        const r = await ev({ ...EVAL, spec: { ...SPEC, entry: {} } });
        expect(r.status).toBe(422);
        expect(r.body.issues[0]).toHaveProperty('path');
        expect(futuresRest.klines).not.toHaveBeenCalled();
    });
    test('strategyId: own works, foreign / unknown / malformed are all 404', async () => {
        const { body: mine } = await call('post', '/', { user: A, body: { spec: SPEC } });
        expect((await ev({ ...EVAL, strategyId: String(mine._id) })).status).toBe(200);
        expect((await ev({ ...EVAL, strategyId: String(mine._id) }, B)).status).toBe(404);
        expect((await ev({ ...EVAL, strategyId: oid() })).status).toBe(404);
        expect((await ev({ ...EVAL, strategyId: { $ne: null } })).status).toBe(404);
    });
    test('upstream failure -> 502 with a generic body', async () => {
        futuresRest.klines.mockRejectedValue(new Error('secret upstream detail'));
        const r = await ev({ ...EVAL, spec: SPEC });
        expect(r).toMatchObject({ status: 502, body: { error: 'market_data_unavailable' } });
    });
    test('30/min per user then 429', async () => {
        const u = oid();
        for (let i = 0; i < 30; i++) expect((await ev({ ...EVAL, spec: SPEC }, u)).status).toBe(200);
        expect((await ev({ ...EVAL, spec: SPEC }, u)).status).toBe(429);
        expect((await ev({ ...EVAL, spec: SPEC }, oid())).status).toBe(200);
    });
});
