// Route-level tests for /api/auth/me, PATCH /me and POST /password. No sockets (the sandbox forbids listening):
// the route's real middleware chain runs against mocked req/res, like the other handler tests.
// No MongoDB is available to tests, so the User model is an in-memory store. Documents are seeded through the real
// schema (so schema defaults apply), and save() stands in for the pre-save hash.
jest.mock('../config/config', () => ({ jwt: { secret: 'k'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models/User', () => {
    const bcrypt = require('bcryptjs');
    const Real = jest.requireActual('../models/User');
    const store = new Map(); // String(_id) -> stored fields (no methods)
    const clone = (v) => (v instanceof Date || (v && v._bsontype) ? v
        : Array.isArray(v) ? v.map(clone)
            : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
    const setPath = (obj, path, v) => {
        const keys = path.split('.');
        let o = obj;
        for (const k of keys.slice(0, -1)) { o[k] = o[k] || {}; o = o[k]; }
        o[keys[keys.length - 1]] = v;
    };
    const docFor = (id) => {
        const raw = store.get(String(id));
        if (!raw) return null;
        const doc = clone(raw);
        doc.matchPassword = function (p) { return bcrypt.compare(p, this.password); };
        doc.save = async function () {
            // stands in for the schema pre-save hook: a changed plain password is hashed before it is stored
            if (this.password !== raw.password) this.password = await bcrypt.hash(this.password, 4);
            const { matchPassword, save, ...fields } = this;
            store.set(String(fields._id), clone(fields));
            return this;
        };
        return doc;
    };
    // Query stand-in: select/lean are no-ops, awaiting runs the lookup.
    const query = (run) => {
        const q = { select: () => q, lean: () => q, then: (ok, ko) => run().then(ok, ko) };
        return q;
    };
    return {
        PAPER_BALANCE: 100000,
        findById: (id) => query(async () => docFor(id)),
        findByIdAndUpdate: (id, update) => query(async () => {
            const raw = store.get(String(id));
            if (!raw) return null;
            for (const [path, v] of Object.entries(update.$set || {})) setPath(raw, path, v);
            for (const [path, v] of Object.entries(update.$inc || {})) setPath(raw, path, (raw[path] || 0) + v); // top-level counters only
            return docFor(id);
        }),
        __store: store,
        __seed: (fields) => { const obj = new Real(fields).toObject(); store.set(String(obj._id), obj); return obj; },
    };
});

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AI_MODELS } = require('../services/aiService');
const authRoutes = require('../routes/authRoutes');

// Runs one route's handler chain (auth, limiter, validators, controller) and resolves with { status, body }.
// Resolves on res.json(); rejects if a middleware passes an error on.
const dispatch = (method, path, { token, body = {} } = {}) => {
    const route = authRoutes.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]).route;
    const req = { method: method.toUpperCase(), headers: token ? { authorization: `Bearer ${token}` } : {}, body, ip: '127.0.0.1' };
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            headers: {},
            status(c) { this.statusCode = c; return this; },
            set(k, v) { this.headers[k] = v; return this; },
            json(b) { resolve({ status: this.statusCode, body: b }); return this; },
        };
        const step = (i) => (err) => {
            if (err) return reject(err);
            const layer = route.stack[i];
            if (!layer) return reject(new Error(`${method} ${path}: chain ended without a response`));
            Promise.resolve(layer.handle(req, res, step(i + 1))).catch(reject);
        };
        step(0)();
    });
};

const UID = '64b7f0c2a1b2c3d4e5f60718';
const OLD_PW = 'correct-horse-1';
const NEW_PW = 'battery-staple-2';
const SECRET = 'k'.repeat(40);
const nowSec = () => Math.floor(Date.now() / 1000);
const tokenFor = (extra = {}) => jwt.sign({ userId: UID, role: 'user', ...extra }, SECRET, { algorithm: 'HS256', expiresIn: '24h' });
const me = (token = tokenFor()) => dispatch('get', '/me', { token });
const patch = (body) => dispatch('patch', '/me', { token: tokenFor(), body });
const changePw = (body, token = tokenFor()) => dispatch('post', '/password', { token, body });

beforeEach(() => {
    User.__store.clear();
    User.__seed({ _id: UID, username: 'alice', email: 'alice@x.io', name: 'Alice', password: bcrypt.hashSync(OLD_PW, 4) });
});

test('GET /me returns schema defaults and the AI model allow-list', async () => {
    const res = await me();
    expect(res.status).toBe(200);
    expect(String(res.body.user._id)).toBe(UID); // ObjectId here; Express would serialise it to the hex string
    expect(res.body.user).toMatchObject({
        username: 'alice', email: 'alice@x.io', name: 'Alice', role: 'user',
        profile: { bio: null, country: null, timezone: null },
        preferences: { defaultSymbol: 'BTCUSDT', defaultTimeframe: '1h', alertToasts: true, alertSound: false },
        ai: { model: null },
    });
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.body.aiModels).toEqual(AI_MODELS);
    expect(AI_MODELS.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
});

test('PATCH /me updates name, profile, preferences and ai.model; untouched fields keep their values', async () => {
    const res = await patch({
        name: '  Alice B  ',
        profile: { bio: 'hi', timezone: 'Europe/London' },
        preferences: { defaultSymbol: 'ETHUSDT', defaultTimeframe: '4h', alertSound: true },
        ai: { model: 'claude-sonnet-5-5' },
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({
        name: 'Alice B',
        profile: { bio: 'hi', country: null, timezone: 'Europe/London' },
        preferences: { defaultSymbol: 'ETHUSDT', defaultTimeframe: '4h', alertToasts: true, alertSound: true },
        ai: { model: 'claude-sonnet-5-5' },
    });
    expect((await me()).body.user.ai.model).toBe('claude-sonnet-5-5');
    expect((await patch({ ai: { model: null } })).body.user.ai.model).toBeNull(); // null clears the choice
});

test('PATCH /me rejects an AI model outside the allow-list and a bad timeframe with 422, changing nothing', async () => {
    const before = JSON.stringify(User.__store.get(UID));
    expect((await patch({ ai: { model: 'gpt-4o' } })).status).toBe(422);
    expect((await patch({ preferences: { defaultTimeframe: '2h' } })).status).toBe(422);
    expect(JSON.stringify(User.__store.get(UID))).toBe(before);
});

test.each([
    [{ role: 'admin' }],
    [{ balance: 1e9 }],
    [{ email: 'x@y.io' }],
    [{ username: 'root' }],
    [{ password: 'hacked-pass-1' }],
    [{ preferences: { role: 'admin' } }],
])('PATCH /me rejects %p with 422 and changes nothing', async (body) => {
    const before = JSON.stringify(User.__store.get(UID));
    const res = await patch(body);
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(User.__store.get(UID))).toBe(before);
});

test('POST /password: success returns a working token; a token issued before the change is then rejected', async () => {
    const oldToken = tokenFor({ iat: nowSec() - 5 }); // issued before the change
    const res = await changePw({ currentPassword: OLD_PW, newPassword: NEW_PW }, oldToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');

    const stored = User.__store.get(UID);
    expect(await bcrypt.compare(NEW_PW, stored.password)).toBe(true); // hashed on save, never stored plain
    expect(stored.passwordChangedAt).toBeInstanceOf(Date);

    const claims = jwt.decode(res.body.token);
    expect(claims).toMatchObject({ userId: UID, role: 'user' });
    expect(claims.exp - claims.iat).toBe(24 * 3600);

    expect((await me(res.body.token)).status).toBe(200);
    const stale = await me(oldToken);
    expect(stale.status).toBe(401);
    expect(stale.body).toEqual({ success: false, message: 'Invalid token' });
});

test('POST /password: wrong current password -> 401 and nothing changes', async () => {
    const res = await changePw({ currentPassword: 'not-the-password', newPassword: NEW_PW });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: 'Current password is incorrect' });
    expect(User.__store.get(UID).passwordChangedAt).toBeUndefined();
});

test('POST /password: new password equal to the current one -> 400; too short -> 422', async () => {
    expect((await changePw({ currentPassword: OLD_PW, newPassword: OLD_PW })).status).toBe(400);
    expect((await changePw({ currentPassword: OLD_PW, newPassword: 'short' })).status).toBe(422);
});

test('a locked account is rejected even with a valid, unexpired token', async () => {
    User.__store.get(UID).lockedAt = new Date();
    const res = await me();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: 'Invalid token' });
});
