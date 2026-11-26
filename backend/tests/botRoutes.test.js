// /api/bots routes, dispatched in-process through the real router (no sockets, no DB, no network). Nothing here trades.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ overview: jest.fn(async () => [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }]), klines: jest.fn(async () => { throw new Error('no data'); }) }));
jest.mock('../services/tradeFill', () => ({ fillPrice: jest.fn(async () => ({ price: 50000, ageMs: 10 })) }));

jest.mock('../models/Bot', () => {
    const { Types } = require('mongoose');
    const rows = [];
    const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
    const set = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
    const eq = (a, b) => String(a) === String(b);
    const cond = (a, c) => {
        if (c && typeof c === 'object' && !(c instanceof Date) && !(c instanceof Types.ObjectId)) {
            if ('$ne' in c) return !eq(a, c.$ne);
            if ('$lt' in c) return a < c.$lt;
            if ('$in' in c) return c.$in.some((x) => eq(x, a));
        }
        return eq(a, c);
    };
    const match = (r, f) => Object.entries(f).every(([k, v]) => cond(get(r, k), v));
    const apply = (r, u) => {
        Object.entries(u.$set || {}).forEach(([k, v]) => set(r, k, v));
        Object.entries(u.$inc || {}).forEach(([k, v]) => set(r, k, (get(r, k) || 0) + v));
    };
    const q = (fn) => { const o = { sort: () => o, limit: () => o, lean: () => o, then: (ok, ko) => Promise.resolve().then(fn).then(ok, ko) }; return o; };
    return {
        __rows: rows,
        find: (f) => q(() => rows.filter((r) => match(r, f)).map((r) => ({ ...r }))),
        findOne: (f) => q(() => { const r = rows.find((x) => match(x, f)); return r ? { ...r } : null; }),
        countDocuments: async (f) => rows.filter((r) => match(r, f)).length,
        create: async (d) => {
            const r = { _id: new Types.ObjectId(), status: 'proposed', rev: 0, acceptedHash: null, acceptedAt: null, positionId: null, startMark: null, startedAt: null, day: { key: '', trades: 0, realizedCents: 0 }, createdAt: new Date(), ...d };
            rows.push(r); return { toObject: () => ({ ...r }) };
        },
        findOneAndUpdate: (f, u) => q(() => { const r = rows.find((x) => match(x, f)); if (r) apply(r, u); return r ? { ...r } : null; }),
        updateOne: async (f, u) => { const r = rows.find((x) => match(x, f)); if (r) apply(r, u); return { modifiedCount: r ? 1 : 0 }; },
        updateMany: async (f, u) => { rows.filter((x) => match(x, f)).forEach((r) => apply(r, u)); },
        deleteOne: async (f) => { const i = rows.findIndex((x) => match(x, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    };
});
jest.mock('../models/BotDecision', () => {
    const { Types } = require('mongoose');
    const rows = [];
    let t = Date.now();
    const q = (fn) => { const o = { sort: () => o, limit: (n) => { o.n = n; return o; }, lean: () => o, then: (ok, ko) => Promise.resolve().then(() => fn(o)).then(ok, ko) }; return o; };
    return {
        __rows: rows,
        create: async (d) => { const r = { _id: new Types.ObjectId(), at: new Date(t += 1000), ...d }; rows.push(r); return r; },
        find: (f) => q((o) => rows.filter((r) => String(r.botId) === String(f.botId) && String(r.userId) === String(f.userId)
            && (!f.kind || r.kind === f.kind) && (!f.at || r.at < f.at.$lt)).sort((a, b) => b.at - a.at).slice(0, o.n).map((r) => ({ ...r }))),
    };
});
jest.mock('../models/Strategy', () => ({ findOne: () => ({ lean: async () => null }) }));

const mongoose = require('mongoose');
const Bot = require('../models/Bot');
const BotDecision = require('../models/BotDecision');
const router = require('../routes/botRoutes');

const oid = () => String(new mongoose.Types.ObjectId());

const call = (method, path, { user, body = {}, params = {}, query = {} } = {}) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const req = { method: method.toUpperCase(), headers: {}, body, params, query, user: { userId: user }, ip: '127.0.0.1' };
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
const NO_STOP = { ...SPEC, risk: {} };

// Each test uses fresh users so the per-user write limiter never leaks between tests.
let U;
let V;
const create = (user, body = {}) => call('post', '/', { user, body: { spec: SPEC, symbol: 'BTC', ...body } });
const accepted = async (user, body) => {
    const c = await create(user, body);
    expect(c.status).toBe(201);
    const id = String(c.body.bot._id);
    const a = await call('post', '/:id/accept', { user, params: { id }, body: { acceptHash: c.body.acceptHash, ack: true } });
    expect(a.status).toBe(200);
    return id;
};
const act = (user, id, what, extra = {}) => call('post', `/:id/${what}`, { user, params: { id }, ...extra });

beforeEach(() => {
    Bot.__rows.length = 0;
    BotDecision.__rows.length = 0;
    U = oid(); V = oid();
    delete process.env.BOTS_ENABLED;
});

describe('create', () => {
    test('201: proposed, defaults ($1000, 1x, $50, 10), hash to sign, worst case; backtest unavailable is tolerated', async () => {
        const r = await create(U);
        expect(r.status).toBe(201);
        expect(r.body.bot).toMatchObject({ status: 'proposed', symbol: 'BTC', interval: '1h', sizeUsd: 1000, leverage: 1, accepted: false, limits: { dailyLossUsd: 50, maxTradesPerDay: 10, maxLeverage: 1, maxPositionUsd: 1000, symbols: ['BTC'] } });
        expect(r.body.acceptHash).toMatch(/^[a-f0-9]{64}$/);
        expect(r.body.worstCaseLossCents).toBe(2100);
        expect(r.body.backtest).toBeNull();
        expect(r.body.problem).toBeNull();
    });
    test('422 WARMUP_TOO_LONG: indicators needing more closed candles than the engine fetches are refused at create', async () => {
        const r = await create(U, { spec: { ...SPEC, indicators: [{ id: 'fast', type: 'ema', source: 'close', period: 200 }, SPEC.indicators[1]] } });
        expect(r.status).toBe(422);
        expect(r.body.code).toBe('WARMUP_TOO_LONG');
        expect(Bot.__rows).toHaveLength(0);
    });
    test.each([
        ['symbol not on the allow-list', { symbol: 'DOGE' }], ['leverage 6', { leverage: 6 }], ['size over $25,000', { sizeUsd: 25001 }],
        ['unknown field', { userId: 'x' }], ['bad interval', { interval: '1m' }], ['symbols outside allow-list', { limits: { symbols: ['BTC', 'DOGE'] } }],
        ['spec and strategyId together', { strategyId: oid() }],
    ])('400 for %s', async (n, extra) => {
        const r = await create(U, extra);
        expect(r.status).toBe(400);
        expect(Bot.__rows).toHaveLength(0);
    });
    test('invalid spec -> 422 without echoing it', async () => {
        const r = await create(U, { spec: { ...SPEC, code: 'x' } });
        expect(r.status).toBe(422);
        expect(JSON.stringify(r.body)).not.toContain('code');
    });
    test('5 bots per user: the 6th is 409 BOT_LIMIT, another user is unaffected', async () => {
        const w = oid();
        for (let i = 0; i < 5; i++) expect((await create(w)).status).toBe(201);
        const r = await create(w);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('BOT_LIMIT');
        expect((await create(U)).status).toBe(201);
    });
    test('writes are limited to 30 a minute per user', async () => {
        const w = oid();
        let last;
        for (let i = 0; i < 31; i++) last = await call('post', '/stop-all', { user: w });
        expect(last.status).toBe(429);
    });
});

describe('ownership and auth', () => {
    test("another user's bot is 404 on every route; lists show only own bots", async () => {
        const id = await accepted(U);
        const p = { user: V, params: { id } };
        const rs = [
            await call('get', '/:id', p), await call('put', '/:id', { ...p, body: { name: 'x' } }), await call('post', '/:id/accept', { ...p, body: { acceptHash: 'a', ack: true } }),
            await call('post', '/:id/decline', p), await call('post', '/:id/start', p), await call('post', '/:id/pause', p), await call('post', '/:id/stop', p),
            await call('get', '/:id/decisions', p), await call('delete', '/:id', p),
        ];
        expect(rs.map((r) => r.status)).toEqual(Array(9).fill(404));
        expect((await call('get', '/', { user: V })).body).toEqual([]);
        expect((await call('get', '/', { user: U })).body).toHaveLength(1);
        expect(Bot.__rows[0].status).toBe('paused'); // untouched
    });
    test('malformed id -> 404, not a CastError', async () => {
        expect((await call('get', '/:id', { user: U, params: { id: '{"$ne":1}' } })).status).toBe(404);
    });
    test('the owner comes from the JWT, never the body', async () => {
        expect((await create(U, { userId: V })).status).toBe(400);
    });
});

describe('accept / decline', () => {
    test('stale or wrong hash -> 409 and the bot stays proposed; right hash -> paused with acceptance recorded', async () => {
        const c = await create(U);
        const id = String(c.body.bot._id);
        const bad = await act(U, id, 'accept', { body: { acceptHash: 'f'.repeat(64), ack: true } });
        expect(bad).toMatchObject({ status: 409, body: { code: 'HASH_MISMATCH' } });
        expect(Bot.__rows[0].status).toBe('proposed');
        expect((await act(U, id, 'accept', { body: { acceptHash: c.body.acceptHash } })).status).toBe(400); // no ack
        const ok = await act(U, id, 'accept', { body: { acceptHash: c.body.acceptHash, ack: true } });
        expect(ok.status).toBe(200);
        expect(ok.body).toMatchObject({ status: 'paused', accepted: true, acceptedHash: c.body.acceptHash, disclosureVersion: 1 });
        expect(BotDecision.__rows.map((d) => d.reason.detail)).toEqual(['create', 'accept']);
    });
    test('the hash goes stale if the stored bot changes between create and accept', async () => {
        const c = await create(U);
        Bot.__rows[0].limits.dailyLossUsd = 500;
        expect((await act(U, String(c.body.bot._id), 'accept', { body: { acceptHash: c.body.acceptHash, ack: true } })).status).toBe(409);
    });
    test('a spec without stopPct cannot be accepted', async () => {
        const c = await create(U, { spec: NO_STOP });
        expect(c.body.problem).toBe('STOP_REQUIRED');
        const r = await act(U, String(c.body.bot._id), 'accept', { body: { acceptHash: c.body.acceptHash, ack: true } });
        expect(r).toMatchObject({ status: 422, body: { code: 'STOP_REQUIRED' } });
        expect(Bot.__rows[0].status).toBe('proposed');
    });
    test('a stop beyond liquidation cannot be accepted (5x, 25% stop)', async () => {
        const c = await create(U, { spec: { ...SPEC, risk: { stopPct: 25 } }, leverage: 5, limits: { maxLeverage: 5, dailyLossUsd: 1000 } });
        expect(c.status).toBe(201);
        const r = await act(U, String(c.body.bot._id), 'accept', { body: { acceptHash: c.body.acceptHash, ack: true } });
        expect(r).toMatchObject({ status: 422, body: { code: 'STOP_BEYOND_LIQ' } });
    });
    test('accepting twice -> 409; decline is terminal', async () => {
        const id = await accepted(U);
        expect((await act(U, id, 'accept', { body: { acceptHash: 'x', ack: true } })).status).toBe(409);
        expect((await act(U, id, 'decline')).body.status).toBe('declined');
        expect((await act(U, id, 'start')).status).toBe(409);
        expect((await act(U, id, 'decline')).status).toBe(409);
    });
});

// Runs `mutate` once, right after the first Bot.findOne() snapshot is taken: a concurrent writer slipping in between
// the route's load and its conditional update.
const raceAfterLoad = (mutate) => {
    const orig = Bot.findOne;
    let done = false;
    const spy = jest.spyOn(Bot, 'findOne').mockImplementation((f) => {
        const q = orig(f);
        if (done) return q;
        done = true;
        return { lean: () => ({ then: (ok, ko) => q.then((r) => { mutate(); return r; }).then(ok, ko) }) };
    });
    return spy;
};

describe('rev guard and positionId guard', () => {
    test('accept: a concurrent edit (rev bump) between load and update -> 409, bot stays proposed', async () => {
        const c = await create(U);
        const spy = raceAfterLoad(() => { Bot.__rows[0].sizeUsd = 777; Bot.__rows[0].rev += 1; });
        try {
            expect(await act(U, String(c.body.bot._id), 'accept', { body: { acceptHash: c.body.acceptHash, ack: true } })).toMatchObject({ status: 409, body: { code: 'BAD_STATE' } });
        } finally { spy.mockRestore(); }
        expect(Bot.__rows[0]).toMatchObject({ status: 'proposed', acceptedHash: null, sizeUsd: 777 });
    });
    test('start: a concurrent edit (rev bump) between load and update -> 409, bot stays paused, not running', async () => {
        const id = await accepted(U);
        const spy = raceAfterLoad(() => { Bot.__rows[0].rev += 1; });
        try {
            expect((await act(U, id, 'start')).status).toBe(409);
        } finally { spy.mockRestore(); }
        expect(Bot.__rows[0].status).toBe('paused');
    });
    test('decline and edit are refused (409) while a paused bot still holds a position', async () => {
        const id = await accepted(U);
        Bot.__rows[0].positionId = new mongoose.Types.ObjectId();
        expect((await act(U, id, 'decline')).status).toBe(409);
        expect((await call('put', '/:id', { user: U, params: { id }, body: { name: 'n2' } })).status).toBe(409);
        expect(Bot.__rows[0]).toMatchObject({ status: 'paused' });
        expect(Bot.__rows[0].acceptedHash).not.toBeNull();
        Bot.__rows[0].positionId = null; // flat again: both work
        expect((await call('put', '/:id', { user: U, params: { id }, body: { name: 'n2' } })).status).toBe(200);
    });
});

describe('edit clears acceptance', () => {
    test('edit after accept -> proposed, acceptance gone, start refused until re-accepted', async () => {
        const id = await accepted(U);
        const e = await call('put', '/:id', { user: U, params: { id }, body: { sizeUsd: 500 } });
        expect(e.status).toBe(200);
        expect(e.body).toMatchObject({ status: 'proposed', acceptedHash: null, accepted: false, sizeUsd: 500 });
        expect((await act(U, id, 'start')).status).toBe(409);
        expect(Bot.__rows[0].status).toBe('proposed');
        const a = await act(U, id, 'accept', { body: { acceptHash: e.body.acceptHash, ack: true } });
        expect(a.status).toBe(200);
        expect((await act(U, id, 'start')).status).toBe(200);
    });
    test('edits are validated and a running bot cannot be edited', async () => {
        const id = await accepted(U);
        expect((await call('put', '/:id', { user: U, params: { id }, body: { leverage: 9 } })).status).toBe(400);
        expect((await call('put', '/:id', { user: U, params: { id }, body: { symbol: 'ETH' } })).status).toBe(400);
        expect((await call('put', '/:id', { user: U, params: { id }, body: {} })).status).toBe(400);
        await act(U, id, 'start');
        expect((await call('put', '/:id', { user: U, params: { id }, body: { name: 'n' } })).status).toBe(409);
    });
});

describe('start / pause / stop', () => {
    test('start without accept is refused', async () => {
        const c = await create(U);
        expect(await act(U, String(c.body.bot._id), 'start')).toMatchObject({ status: 409, body: { code: 'NOT_ACCEPTED' } });
    });
    test('start needs the stored bot to still match the accepted hash', async () => {
        const id = await accepted(U);
        Bot.__rows[0].sizeUsd = 999; // tampered with outside the API
        expect((await act(U, id, 'start')).status).toBe(409);
        expect(Bot.__rows[0].status).toBe('paused');
    });
    test('start -> running with startMark; pause -> paused; stop -> stopped; each writes a lifecycle row', async () => {
        const id = await accepted(U);
        const s = await act(U, id, 'start');
        expect(s.body).toMatchObject({ status: 'running', startMark: 50000 });
        expect((await act(U, id, 'start')).status).toBe(409);
        expect((await act(U, id, 'pause')).body.status).toBe('paused');
        expect((await act(U, id, 'pause')).status).toBe(409);
        expect((await act(U, id, 'start')).status).toBe(200);
        expect((await act(U, id, 'stop')).body).toMatchObject({ status: 'stopped', stopReason: 'user' });
        expect((await act(U, id, 'start')).status).toBe(409); // stopped is terminal for start
        expect(BotDecision.__rows.map((d) => d.reason.detail)).toEqual(['create', 'accept', 'start', 'pause', 'start', 'stop']);
    });
    test('BOTS_ENABLED=false refuses start; unset in production is off, "true" turns it on', async () => {
        const id = await accepted(U);
        process.env.BOTS_ENABLED = 'false';
        expect(await act(U, id, 'start')).toMatchObject({ status: 403, body: { code: 'BOTS_DISABLED' } });
        delete process.env.BOTS_ENABLED;
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            expect(router.botsEnabled()).toBe(false);
            process.env.BOTS_ENABLED = 'true';
            expect(router.botsEnabled()).toBe(true);
        } finally { process.env.NODE_ENV = prev; }
        expect((await call('get', '/config', { user: U })).body.botsEnabled).toBe(true);
        expect(Bot.__rows[0].status).toBe('paused');
    });
    test('at most 3 running per user: the 4th start is 409 RUNNING_LIMIT and stays paused', async () => {
        const ids = [];
        for (let i = 0; i < 4; i++) ids.push(await accepted(U));
        for (let i = 0; i < 3; i++) expect((await act(U, ids[i], 'start')).status).toBe(200);
        expect(await act(U, ids[3], 'start')).toMatchObject({ status: 409, body: { code: 'RUNNING_LIMIT' } });
        expect(Bot.__rows.map((r) => r.status)).toEqual(['running', 'running', 'running', 'paused']);
        await act(U, ids[0], 'pause');
        expect((await act(U, ids[3], 'start')).status).toBe(200);
    });
    test('two concurrent starts with one slot left: never more than 3 running (both may lose: safe side)', async () => {
        const ids = [];
        for (let i = 0; i < 4; i++) ids.push(await accepted(U));
        await act(U, ids[0], 'start'); await act(U, ids[1], 'start');
        const r = await Promise.all([act(U, ids[2], 'start'), act(U, ids[3], 'start')]);
        expect(r.filter((x) => x.status === 200).length).toBeLessThanOrEqual(1);
        expect(r.every((x) => [200, 409].includes(x.status))).toBe(true);
        expect(Bot.__rows.filter((b) => b.status === 'running').length).toBeLessThanOrEqual(3);
        expect(Bot.__rows.filter((b) => b.status === 'running')).toHaveLength(2 + r.filter((x) => x.status === 200).length);
    });
    test('a refused start (cap) leaves startedAt and startMark unset', async () => {
        const ids = [];
        for (let i = 0; i < 4; i++) ids.push(await accepted(U));
        for (let i = 0; i < 3; i++) await act(U, ids[i], 'start');
        expect((await act(U, ids[3], 'start')).status).toBe(409);
        const row = Bot.__rows[3];
        expect(row.startedAt).toBeNull();
        expect(row.startMark).toBeNull();
        expect(Bot.__rows[0].startedAt).toBeInstanceOf(Date);
    });
    test('cap race, bad interleaving: B reads first but flips after A has finished -> B sees 4 running and reverts itself', async () => {
        const ids = [];
        for (let i = 0; i < 4; i++) ids.push(await accepted(U));
        await act(U, ids[0], 'start'); await act(U, ids[1], 'start');
        const [A, B] = [ids[2], ids[3]];
        let release;
        const gate = new Promise((r) => { release = r; });
        const orig = Bot.findOneAndUpdate;
        const spy = jest.spyOn(Bot, 'findOneAndUpdate').mockImplementation((f, u) => (String(f._id) === B && u.$set && u.$set.status === 'running'
            ? { lean: () => gate.then(() => orig(f, u)) } : orig(f, u)));
        try {
            const pB = act(U, B, 'start'); // captured its timestamp, parked just before its flip
            await new Promise((r) => setTimeout(r, 5));
            const rA = await act(U, A, 'start'); // A flips and finishes completely first (3 running: fine)
            expect(rA.status).toBe(200);
            release();
            const rB = await pB;
            expect(rB).toMatchObject({ status: 409, body: { code: 'RUNNING_LIMIT' } });
        } finally { spy.mockRestore(); }
        expect(Bot.__rows.filter((b) => b.status === 'running')).toHaveLength(3);
        expect(Bot.__rows.find((b) => String(b._id) === B)).toMatchObject({ status: 'paused', startedAt: null });
    });
    test('the cap is per user', async () => {
        const mine = []; const theirs = [];
        for (let i = 0; i < 3; i++) { mine.push(await accepted(U)); theirs.push(await accepted(V)); }
        for (const id of mine) expect((await act(U, id, 'start')).status).toBe(200);
        for (const id of theirs) expect((await act(V, id, 'start')).status).toBe(200);
    });
    test('stop-all stops only my running and paused bots', async () => {
        const a = await accepted(U); const b = await accepted(U); const other = await accepted(V);
        await act(U, a, 'start'); await act(V, other, 'start');
        const r = await call('post', '/stop-all', { user: U });
        expect(r.body).toEqual({ stopped: 2 });
        const by = Object.fromEntries(Bot.__rows.map((x) => [String(x._id), x.status]));
        expect(by).toEqual({ [a]: 'stopped', [b]: 'stopped', [other]: 'running' });
        expect(BotDecision.__rows.filter((d) => d.reason.detail === 'stop_all')).toHaveLength(2);
    });
});

describe('decisions, delete, config', () => {
    test('decisions: newest first, kind filter, limit and before validated, own bot only', async () => {
        const id = await accepted(U);
        await act(U, id, 'start');
        const all = await call('get', '/:id/decisions', { user: U, params: { id } });
        expect(all.body.map((d) => d.reason.detail)).toEqual(['start', 'accept', 'create']);
        expect((await call('get', '/:id/decisions', { user: U, params: { id }, query: { limit: '2' } })).body).toHaveLength(2);
        expect((await call('get', '/:id/decisions', { user: U, params: { id }, query: { kind: 'tick' } })).body).toEqual([]);
        for (const query of [{ limit: '101' }, { limit: '0' }, { kind: 'x' }, { before: 'nope' }]) {
            expect((await call('get', '/:id/decisions', { user: U, params: { id }, query })).status).toBe(400);
        }
        const cut = String(all.body[1].at.getTime());
        expect((await call('get', '/:id/decisions', { user: U, params: { id }, query: { before: cut } })).body.map((d) => d.reason.detail)).toEqual(['create']);
    });
    test('delete: refused while running or with a position, otherwise removes the bot', async () => {
        const id = await accepted(U);
        await act(U, id, 'start');
        expect((await call('delete', '/:id', { user: U, params: { id } })).status).toBe(409);
        await act(U, id, 'pause');
        Bot.__rows[0].positionId = oid();
        expect((await call('delete', '/:id', { user: U, params: { id } })).status).toBe(409);
        Bot.__rows[0].positionId = null;
        expect((await call('delete', '/:id', { user: U, params: { id } })).body).toEqual({ ok: true });
        expect(Bot.__rows).toHaveLength(0);
    });
    test('config serves caps, defaults, allow-list and the disclosure', async () => {
        const r = (await call('get', '/config', { user: U })).body;
        expect(r.caps).toMatchObject({ MAX_BOTS: 5, MAX_RUNNING: 3, MAX_LEVERAGE: 5, MAX_SIZE_USD: 25000 });
        expect(r.defaults).toEqual({ sizeUsd: 1000, leverage: 1, dailyLossUsd: 50, maxTradesPerDay: 10 });
        expect(r.symbols).toEqual(['BTC', 'ETH']);
        expect(r.disclosure).toMatch(/paper money only/i);
    });
});
