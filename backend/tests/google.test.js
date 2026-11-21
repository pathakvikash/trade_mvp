// Google sign-in, /config and the dev-only /dev-hint. Same approach as settings.test.js: the route's real middleware
// chain runs against mocked req/res, the User model is an in-memory store, and google-auth-library is mocked so no
// request leaves the process.
jest.mock('../config/config', () => ({ jwt: { secret: 'k'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn(() => ({ verifyIdToken: (...args) => mockVerifyIdToken(...args) })),
}));

jest.mock('../models/User', () => {
    const Real = jest.requireActual('../models/User');
    const store = new Map(); // String(_id) -> plain fields
    const wrap = (raw) => {
        const doc = { ...raw };
        doc.save = async function () {
            const { save, ...fields } = this;
            store.set(String(fields._id), { ...fields });
            return this;
        };
        return doc;
    };
    const find = (query) => [...store.values()].find((raw) => Object.entries(query).every(([k, v]) => raw[k] === v)) || null;
    return {
        PAPER_BALANCE: 100000,
        findOne: async (query) => { const raw = find(query); return raw ? wrap(raw) : null; },
        create: async (fields) => { const obj = new Real(fields).toObject(); store.set(String(obj._id), obj); return wrap(obj); },
        __store: store,
        __seed: (fields) => { const obj = new Real(fields).toObject(); store.set(String(obj._id), obj); return obj; },
    };
});

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authRoutes = require('../routes/authRoutes');

const SECRET = 'k'.repeat(40);
const GOOD_CLIENT = 'test-client.apps.googleusercontent.com';
const CRED = 'x'.repeat(40); // long enough to pass validation; the verifier itself is mocked
const DEV_ENV = { NODE_ENV: 'development', SEED_DEMO_USERS: 'true', DEMO_GUEST_PASSWORD: 'demo-guest-pass-123' };
const ENV_KEYS = ['NODE_ENV', 'SEED_DEMO_USERS', 'DEMO_GUEST_PASSWORD', 'GOOGLE_CLIENT_ID'];

// Runs one route's handler chain (limiter, validators, controller) and resolves with { status, body }.
const dispatch = (method, path, { body = {}, remote = '127.0.0.1' } = {}) => {
    const route = authRoutes.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]).route;
    const req = { method: method.toUpperCase(), headers: {}, body, ip: '127.0.0.1', socket: { remoteAddress: remote } };
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

const verifiedPayload = (over = {}) => ({ sub: 'google-sub-1', email: 'Jane.Doe@Gmail.com', email_verified: true, name: 'Jane Doe', ...over });
const verifyWith = (payload) => mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload });
const googleLogin = (body = { credential: CRED }) => dispatch('post', '/google', { body });
const onlyUser = () => [...User.__store.values()][0];

let savedEnv;
beforeEach(() => {
    User.__store.clear();
    mockVerifyIdToken.mockReset();
    process.env.GOOGLE_CLIENT_ID = GOOD_CLIENT;
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

describe('POST /api/auth/google', () => {
    test('503 when GOOGLE_CLIENT_ID is unset', async () => {
        delete process.env.GOOGLE_CLIENT_ID;
        const res = await googleLogin();
        expect(res.status).toBe(503);
        expect(res.body).toEqual({ success: false, message: 'Google sign-in is not configured' });
        expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    test('422 for a credential outside 20-4096 chars; verification never runs', async () => {
        const res = await googleLogin({ credential: 'short' });
        expect(res.status).toBe(422);
        expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    test('401 when Google rejects the token', async () => {
        mockVerifyIdToken.mockRejectedValue(new Error('Wrong recipient'));
        const res = await googleLogin();
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ success: false, message: 'Invalid Google credential' });
        expect(User.__store.size).toBe(0);
    });

    test('401 when email_verified is not true; no user is created', async () => {
        verifyWith(verifiedPayload({ email_verified: false }));
        const res = await googleLogin();
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ success: false, message: 'Google account email is not verified' });
        expect(User.__store.size).toBe(0);
    });

    test('new user: sanitised username, unusable random password, googleId stored, token like loginUser', async () => {
        verifyWith(verifiedPayload());
        const res = await googleLogin();
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user).toMatchObject({ username: 'janedoe', email: 'jane.doe@gmail.com', name: 'Jane Doe', role: 'user' });
        expect(res.body.user).not.toHaveProperty('password');

        const stored = onlyUser();
        expect(stored.googleId).toBe('google-sub-1');
        expect(typeof stored.password).toBe('string');
        expect(stored.password.length).toBe(64); // 32 random bytes, hex
        expect(stored.passwordSet).toBe(false); // Settings offers set-a-password without a current one
        expect(res.body.user.security).toEqual({ passwordSet: false, googleLinked: true });

        const claims = jwt.verify(res.body.token, SECRET, { algorithms: ['HS256'] });
        expect(claims).toMatchObject({ role: 'user' });
        expect(claims.userId).toBe(String(res.body.user._id));
        expect(claims.exp - claims.iat).toBe(24 * 3600);
    });

    test('username taken: the new user gets a 4-digit suffix', async () => {
        User.__seed({ email: 'other@x.io', username: 'janedoe', name: 'Other', password: 'h' });
        verifyWith(verifiedPayload());
        const res = await googleLogin();
        expect(res.status).toBe(200);
        expect(res.body.user.username).toMatch(/^janedoe\d{4}$/);
    });

    test('existing account with the same verified email is linked, not duplicated', async () => {
        const seeded = User.__seed({ email: 'alice@x.io', username: 'alice', name: 'Alice', password: 'h' });
        verifyWith(verifiedPayload({ sub: 'google-sub-2', email: 'Alice@x.io' }));
        const res = await googleLogin();
        expect(res.status).toBe(200);
        expect(String(res.body.user._id)).toBe(String(seeded._id));
        expect(User.__store.size).toBe(1);
        expect(User.__store.get(String(seeded._id)).googleId).toBe('google-sub-2');
    });

    test('locked account is refused and is not linked', async () => {
        User.__seed({ email: 'locked@x.io', username: 'locked', name: 'Locked', password: 'h', lockedAt: new Date() });
        verifyWith(verifiedPayload({ sub: 'google-sub-3', email: 'locked@x.io' }));
        const res = await googleLogin();
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(onlyUser().googleId).toBeUndefined();
    });
});

describe('GET /api/auth/config', () => {
    test('returns the client ID when set, null when not', async () => {
        expect((await dispatch('get', '/config')).body).toEqual({ googleClientId: GOOD_CLIENT });
        delete process.env.GOOGLE_CLIENT_ID;
        expect((await dispatch('get', '/config')).body).toEqual({ googleClientId: null });
    });
});

describe('GET /api/auth/dev-hint', () => {
    test('200 with the demo guest only in development, seeding on, long password, loopback caller', async () => {
        Object.assign(process.env, DEV_ENV);
        const res = await dispatch('get', '/dev-hint');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ email: 'guest@cryptozen.com', password: DEV_ENV.DEMO_GUEST_PASSWORD });
    });

    test.each([
        ['not development', { NODE_ENV: 'production' }],
        ['seeding off', { SEED_DEMO_USERS: 'false' }],
        ['password under 12 chars', { DEMO_GUEST_PASSWORD: 'short-pass' }],
    ])('404 when %s', async (_name, override) => {
        Object.assign(process.env, DEV_ENV, override);
        const res = await dispatch('get', '/dev-hint');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false });
    });

    test('404 for a non-loopback caller even in development', async () => {
        Object.assign(process.env, DEV_ENV);
        const res = await dispatch('get', '/dev-hint', { remote: '10.1.2.3' });
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false });
    });
});
