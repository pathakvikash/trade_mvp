// Settings overhaul: preferences/AI validation, avatar, tokenVersion, set-a-password, export, delete account, BYO keys.
// Same style as settings.test.js: real routers and middleware dispatched in-process, in-memory stand-ins for the models.
jest.mock('../config/config', () => ({ jwt: { secret: 'k'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
// Per-route limiters are process-global counters (5/min password, 20/min avatar): switched off here so the tables below can
// call a route many times. createLimiter (the AI per-user limiter) stays real.
jest.mock('../middleware/rateLimit', () => ({ ...jest.requireActual('../middleware/rateLimit'), limitBy: () => (req, res, next) => next() }));
jest.mock('../services/alertService', () => ({ kick: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ isKnownSymbol: async () => true, overview: async () => [], stats: async () => null, liqmap: async () => null, klines: async () => [] }));
jest.mock('../models/User', () => {
    const bcrypt = require('bcryptjs');
    const Real = jest.requireActual('../models/User');
    const store = new Map();
    const clone = (v) => (v instanceof Date || (v && v._bsontype) ? v
        : Array.isArray(v) ? v.map(clone)
            : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
    const walk = (obj, path, create) => {
        const keys = path.split('.');
        let o = obj;
        for (const k of keys.slice(0, -1)) { if (create) o[k] = o[k] || {}; o = o && o[k]; if (!o) return [null, null]; }
        return [o, keys[keys.length - 1]];
    };
    const apply = (raw, update) => {
        for (const [p, v] of Object.entries(update.$set || {})) { const [o, k] = walk(raw, p, true); o[k] = v; }
        for (const p of Object.keys(update.$unset || {})) { const [o, k] = walk(raw, p, false); if (o) delete o[k]; }
        for (const [p, v] of Object.entries(update.$inc || {})) { const [o, k] = walk(raw, p, true); o[k] = (o[k] || 0) + v; }
    };
    const docFor = (id) => {
        const raw = store.get(String(id));
        if (!raw) return null;
        const doc = clone(raw);
        doc.matchPassword = function (p) { return bcrypt.compare(p, this.password); };
        doc.save = async function () {
            if (this.password !== raw.password) this.password = await bcrypt.hash(this.password, 4);
            const { matchPassword, save, ...fields } = this;
            store.set(String(fields._id), clone(fields));
            return this;
        };
        return doc;
    };
    const query = (run) => { const q = { select: () => q, lean: () => q, then: (ok, ko) => run().then(ok, ko) }; return q; };
    return {
        PAPER_BALANCE: 100000,
        findById: (id) => query(async () => docFor(id)),
        findByIdAndUpdate: (id, update) => query(async () => { const raw = store.get(String(id)); if (!raw) return null; apply(raw, update); return docFor(id); }),
        // conditional update, check + apply in one synchronous step like Mongo's per-document atomicity
        updateOne: async (filter, update) => {
            const raw = store.get(String(filter._id));
            if (!raw || ('lockedAt' in filter && filter.lockedAt === null && raw.lockedAt)) return { modifiedCount: 0 };
            apply(raw, update);
            return { modifiedCount: 1 };
        },
        deleteOne: async (filter) => ({ deletedCount: store.delete(String(filter._id)) ? 1 : 0 }),
        __store: store,
        __seed: (fields) => { const obj = new Real(fields).toObject(); Object.assign(obj, { holdings: fields.holdings || {} }); store.set(String(obj._id), obj); return obj; },
    };
});

// Generic per-collection stand-in for Trade/Order/Position/FuturesOrder/FuturesOp/Alert/AlertEvent.
const mockColl = () => {
    const rows = [];
    const match = (r, f) => Object.entries(f).every(([k, v]) => (v && v.$in ? v.$in.includes(r[k]) : String(r[k]) === String(v)));
    return {
        __rows: rows,
        find: (f) => ({ lean: async () => rows.filter((r) => match(r, f)).map((r) => ({ ...r })) }),
        exists: async (f) => (rows.some((r) => match(r, f)) ? { _id: 1 } : null),
        deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) rows.splice(i, 1); },
    };
};
['Trade', 'Order', 'Position', 'FuturesOrder', 'FuturesOp', 'Alert', 'AlertEvent', 'Strategy', 'AiConversation'].forEach((n) => jest.mock(`../models/${n}`, () => mockColl()));

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const models = Object.fromEntries(['Trade', 'Order', 'Position', 'FuturesOrder', 'FuturesOp', 'Alert', 'AlertEvent', 'Strategy', 'AiConversation'].map((n) => [n, require(`../models/${n}`)]));
const secretBox = require('../services/secretBox');
const alertService = require('../services/alertService');
const ai = require('../services/aiService');
const providers = require('../services/aiProviders');
const authRoutes = require('../routes/authRoutes');
const aiRoutes = require('../routes/aiRoutes');
const { accountOk } = require('../middleware/auth');

const UID = '64b7f0c2a1b2c3d4e5f60718';
const UID2 = '64b7f0c2a1b2c3d4e5f60719';
const SECRET = 'k'.repeat(40);
const OLD_PW = 'correct-horse-1';
const NEW_PW = 'battery-staple-2';
const KEY = 'sk-test-PLAINTEXTKEY-9876';
const tokenFor = (extra = {}, uid = UID) => jwt.sign({ userId: uid, role: 'user', ...extra }, SECRET, { algorithm: 'HS256', expiresIn: '24h' });

// Runs a route's whole chain (router-level middleware first for the ai router) and resolves with { status, body, headers }.
const run = (router, method, path, { token, body = {}, params = {} } = {}) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const chain = [...router.stack.filter((l) => !l.route).map((l) => l.handle), ...layer.route.stack.map((l) => l.handle)];
    const req = { method: method.toUpperCase(), headers: token ? { authorization: `Bearer ${token}` } : {}, body, params, ip: '127.0.0.1' };
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200, headers: {},
            status(c) { this.statusCode = c; return this; },
            set(k, v) { this.headers[k] = v; return this; },
            json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); return this; },
        };
        const step = (i) => (err) => {
            if (err) return reject(err);
            if (!chain[i]) return reject(new Error(`${method} ${path}: no response`));
            Promise.resolve(chain[i](req, res, step(i + 1))).catch(reject);
        };
        step(0)();
    });
};
const auth = (m, p, o = {}) => run(authRoutes, m, p, { token: tokenFor(), ...o });
const aiApi = (m, p, o = {}) => run(aiRoutes, m, p, { token: tokenFor(), ...o });
const patch = (body) => auth('patch', '/me', { body });
const stored = () => User.__store.get(UID);

beforeEach(() => {
    alertService.kick.mockClear();
    User.__store.clear();
    Object.values(models).forEach((m) => { m.__rows.length = 0; });
    User.__seed({ _id: UID, username: 'alice', email: 'Alice@x.io', name: 'Alice', password: bcrypt.hashSync(OLD_PW, 4), googleId: 'g-123', futuresOps: { abc: 1 } });
});

describe('PATCH /me validation', () => {
    test('accepts every new preference and AI field, returns them, and ignores nothing silently', async () => {
        const res = await patch({
            preferences: { landingPage: 'portfolio', compactTables: true, tickerBar: false, tickerSpeed: 'fast', fundingCountdown: false, reduceMotion: true, timeFormat: '24h', confirmClose: false, defaultLeverage: 25, defaultOrderType: 'limit' },
            ai: { provider: 'openai', systemPrompt: '  be brief  ', temperature: 0.4, length: 'short', includePortfolio: true, providers: { openai: { model: 'gpt-5' }, custom: { model: 'my/model:1', baseUrl: 'https://llm.example.com/v1' } } },
        });
        expect(res.status).toBe(200);
        expect(res.body.user.preferences).toMatchObject({ landingPage: 'portfolio', compactTables: true, tickerBar: false, tickerSpeed: 'fast', fundingCountdown: false, reduceMotion: true, timeFormat: '24h', confirmClose: false, defaultLeverage: 25, defaultOrderType: 'limit' });
        expect(res.body.user.ai).toMatchObject({ provider: 'openai', systemPrompt: 'be brief', temperature: 0.4, length: 'short', includePortfolio: true });
        expect(res.body.user.ai.providers.openai).toEqual({ model: 'gpt-5', keySet: false, keyLast4: null });
        expect(res.body.user.ai.providers.custom).toEqual({ model: 'my/model:1', baseUrl: 'https://llm.example.com/v1', keySet: false, keyLast4: null });
        expect((await patch({ ai: { temperature: null } })).body.user.ai.temperature).toBeNull();
        expect((await patch({ ai: { providers: { custom: { baseUrl: '' } } } })).body.user.ai.providers.custom.baseUrl).toBe('');
    });

    test.each([
        [{ preferences: { landingPage: 'admin' } }], [{ preferences: { landingPage: ['trade'] } }], [{ preferences: { tickerSpeed: 'warp' } }],
        [{ preferences: { timeFormat: '36h' } }], [{ preferences: { defaultOrderType: 'stop' } }],
        [{ preferences: { compactTables: 'yes' } }], [{ preferences: { tickerBar: 1 } }], [{ preferences: { reduceMotion: null } }], [{ preferences: { confirmClose: 'false' } }], [{ preferences: { fundingCountdown: 0 } }],
        [{ preferences: { defaultLeverage: 0 } }], [{ preferences: { defaultLeverage: 51 } }], [{ preferences: { defaultLeverage: 2.5 } }], [{ preferences: { defaultLeverage: '10' } }],
        [{ preferences: { theme: 'light' } }],
        [{ ai: { provider: 'gpt' } }], [{ ai: { length: 'huge' } }], [{ ai: { includePortfolio: 'true' } }],
        [{ ai: { temperature: 1.1 } }], [{ ai: { temperature: -0.1 } }], [{ ai: { temperature: '0.5' } }], [{ ai: { temperature: NaN } }],
        [{ ai: { systemPrompt: 'x'.repeat(2001) } }], [{ ai: { systemPrompt: 5 } }],
        [{ ai: { keyEnc: 'x' } }], [{ ai: { apiKey: KEY } }], [{ ai: { providers: { openai: { keyEnc: 'x' } } } }], [{ ai: { providers: { openai: { apiKey: KEY } } } }],
        [{ ai: { providers: { openai: { baseUrl: 'https://x.example.com' } } } }], [{ ai: { providers: { evil: { model: 'm' } } } }], [{ ai: { providers: 'openai' } }],
        [{ ai: { providers: { openai: { model: 'has space' } } } }], [{ ai: { providers: { openai: { model: 'x'.repeat(101) } } } }], [{ ai: { providers: { openai: { model: 'bad;rm' } } } }],
        [{ ai: { providers: { custom: { baseUrl: 'http://localhost/v1' } } } }], [{ ai: { providers: { custom: { baseUrl: 'https://u:p@x.example.com/' } } } }], [{ ai: { providers: { custom: { baseUrl: 'https://10.0.0.1/v1' } } } }],
        [{ ai: { providers: { custom: { baseUrl: 'ftp://x.example.com/' } } } }], [{ ai: { providers: { custom: { baseUrl: 5 } } } }],
        [{ profile: { avatar: 'emoji:🦊' } }], [{ tokenVersion: 5 }], [{ passwordSet: false }],
    ])('rejects %j with 422 and changes nothing', async (body) => {
        const before = JSON.stringify(stored());
        const res = await patch(body);
        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(JSON.stringify(stored())).toBe(before);
    });

    test('plain-http custom URLs are refused outside development', async () => {
        expect((await patch({ ai: { providers: { custom: { baseUrl: 'http://llm.example.com/v1' } } } })).status).toBe(422); // NODE_ENV=test
        expect((await patch({ ai: { providers: { custom: { baseUrl: 'https://api.example.com//127.0.0.1/v1' } } } })).status).toBe(422);
    });

    test('production blocks plain-http custom URLs at validation time', async () => {
        process.env.NODE_ENV = 'production';
        try {
            expect((await patch({ ai: { providers: { custom: { baseUrl: 'http://llm.example.com/v1' } } } })).status).toBe(422);
        } finally { process.env.NODE_ENV = 'test'; }
    });
});

describe('GET /me', () => {
    test('exact public shape with defaults, providers list, default prompt and server rules', async () => {
        const res = await auth('get', '/me');
        expect(Object.keys(res.body.user).sort()).toEqual(['_id', 'ai', 'createdAt', 'email', 'name', 'preferences', 'profile', 'role', 'security', 'username']);
        expect(res.body.user.security).toEqual({ passwordSet: true, googleLinked: true });
        expect(res.body.user.profile).toEqual({ bio: null, country: null, timezone: null, avatar: null });
        expect(res.body.user.preferences).toEqual({
            defaultSymbol: 'BTCUSDT', defaultTimeframe: '1h', alertToasts: true, alertSound: false, landingPage: 'dashboard', compactTables: false, tickerBar: true,
            tickerSpeed: 'normal', fundingCountdown: true, reduceMotion: false, timeFormat: 'auto', confirmClose: true, defaultLeverage: 10, defaultOrderType: 'market',
        });
        expect(Object.keys(res.body.user.ai).sort()).toEqual(['includePortfolio', 'length', 'model', 'provider', 'providers', 'systemPrompt', 'temperature']);
        expect(res.body.user.ai).toMatchObject({ provider: 'default', systemPrompt: '', temperature: null, length: 'normal', includePortfolio: false });
        expect(Object.keys(res.body.user.ai.providers)).toEqual(['anthropic', 'openai', 'gemini', 'openrouter', 'custom', 'lmstudio']);
        expect(res.body.aiProviders.map((p) => p.id)).toEqual(['anthropic', 'openai', 'gemini', 'openrouter', 'custom', 'lmstudio']);
        expect(res.body.aiProviders.find((p) => p.id === 'custom')).toMatchObject({ needsBaseUrl: true, modelSuggestions: [] });
        expect(res.body.aiDefaultPrompt).toBe(ai.DEFAULT_STYLE);
        expect(res.body.aiServerRules).toContain('These rules take precedence');
    });
});

describe('avatar', () => {
    const jpeg = (n = 20) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 1)]);
    const webp = (n = 20) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([n, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(n, 1)]);
    const url = (type, buf) => `data:image/${type};base64,${buf.toString('base64')}`;
    const put = (avatar) => auth('put', '/me/avatar', { body: { avatar } });

    test('good jpeg and webp are stored and returned; DELETE clears', async () => {
        const j = url('jpeg', jpeg());
        expect((await put(j)).body.user.profile.avatar).toBe(j);
        expect(stored().profile.avatar).toBe(j);
        const w = url('webp', webp());
        expect((await put(w)).status).toBe(200);
        const del = await auth('delete', '/me/avatar');
        expect(del.status).toBe(200);
        expect(del.body.user.profile.avatar).toBeNull();
        expect((stored().profile || {}).avatar).toBeUndefined();
    });
    test('emoji avatars, including ZWJ sequences, are accepted', async () => {
        expect((await put('emoji:🦊')).body.user.profile.avatar).toBe('emoji:🦊');
        expect((await put('emoji:👩🏽‍💻')).status).toBe(200);
        expect((await put('emoji:🇬🇧')).status).toBe(200);
    });
    test.each([
        ['wrong magic for jpeg', () => url('jpeg', webp())], ['wrong magic for webp', () => url('webp', jpeg())], ['png', () => `data:image/png;base64,${Buffer.from('\x89PNG\r\n\x1a\n').toString('base64')}`],
        ['svg', () => `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`],
        ['oversize (150KB + 1)', () => url('jpeg', jpeg(150 * 1024 + 1))], ['way oversize', () => url('webp', webp(400 * 1024))],
        ['bad base64 characters', () => 'data:image/jpeg;base64,!!!notbase64***'], ['bad padding', () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg'], ['empty payload', () => 'data:image/jpeg;base64,'],
        ['plain text', () => 'hello'], ['emoji: with text only', () => 'emoji:abc'], ['emoji: empty', () => 'emoji:'], ['emoji + markup', () => 'emoji:🦊<script>'],
        ['too long emoji', () => `emoji:${'🦊'.repeat(17)}`], ['http url', () => 'https://evil.example.com/a.jpg'], ['non-string', () => 5],
    ])('%s -> 422, nothing stored', async (name, make) => {
        const res = await put(make());
        expect(res.status).toBe(422);
        expect((stored().profile || {}).avatar).toBeUndefined();
    });
    test('extra body keys are rejected', async () => {
        expect((await auth('put', '/me/avatar', { body: { avatar: 'emoji:🦊', role: 'admin' } })).status).toBe(422);
    });
});

describe('tokenVersion, password change, set-a-password, sign out everywhere', () => {
    test('new tokens carry tv; legacy tokens without tv keep working while tokenVersion is 0', async () => {
        const res = await auth('post', '/logout-all');
        expect(jwt.decode(res.body.token).tv).toBe(1);
        User.__store.get(UID).tokenVersion = 0;
        expect(await accountOk(jwt.decode(tokenFor()))).toBe(true); // no tv in the token == 0
        expect(await accountOk({ userId: UID, tv: 0 })).toBe(true);
        expect(await accountOk({ userId: UID, tv: 1 })).toBe(false);
    });

    test('password change bumps tokenVersion: old token rejected by accountOk and by routes, fresh token works', async () => {
        const old = tokenFor({ tv: 0 });
        const res = await run(authRoutes, 'post', '/password', { token: old, body: { currentPassword: OLD_PW, newPassword: NEW_PW } });
        expect(res.status).toBe(200);
        expect(stored().tokenVersion).toBe(1);
        expect(jwt.decode(res.body.token)).toMatchObject({ userId: UID, tv: 1 });
        expect(await accountOk(jwt.decode(old))).toBe(false);
        expect((await run(authRoutes, 'get', '/me', { token: old })).status).toBe(401);
        expect((await run(authRoutes, 'get', '/me', { token: res.body.token })).status).toBe(200);
    });

    test('password change keeps the old rules: wrong current 401, same password 400, missing current 422', async () => {
        expect((await auth('post', '/password', { body: { currentPassword: 'nope-nope-1', newPassword: NEW_PW } })).status).toBe(401);
        expect((await auth('post', '/password', { body: { currentPassword: OLD_PW, newPassword: OLD_PW } })).status).toBe(400);
        expect((await auth('post', '/password', { body: { newPassword: NEW_PW } })).status).toBe(422);
        expect(stored().tokenVersion).toBe(0); // nothing bumped
    });

    test('logout-all: other sessions die, this one gets a fresh token', async () => {
        const other = tokenFor({ tv: 0 });
        const res = await run(authRoutes, 'post', '/logout-all', { token: other });
        expect(res.status).toBe(200);
        expect(stored().tokenVersion).toBe(1);
        expect((await run(authRoutes, 'get', '/me', { token: other })).status).toBe(401);
        expect((await run(authRoutes, 'get', '/me', { token: res.body.token })).status).toBe(200);
        // twice in a row never reuses a version
        const again = await run(authRoutes, 'post', '/logout-all', { token: res.body.token });
        expect(jwt.decode(again.body.token).tv).toBe(2);
    });

    test('set-a-password: passwordSet false accounts need no current password, then it is a normal account', async () => {
        User.__store.get(UID).passwordSet = false;
        expect((await auth('get', '/me')).body.user.security.passwordSet).toBe(false);
        const res = await auth('post', '/password', { body: { newPassword: NEW_PW } });
        expect(res.status).toBe(200);
        expect(await bcrypt.compare(NEW_PW, stored().password)).toBe(true);
        expect(stored().passwordSet).toBe(true);
        expect(stored().tokenVersion).toBe(1);
        expect((await auth('post', '/password', { token: res.body.token, body: { newPassword: 'another-pass-3' } })).status).toBe(422); // current now required
        expect((await auth('get', '/me', { token: res.body.token })).body.user.security.passwordSet).toBe(true);
    });
    test('set-a-password needs a recent sign-in: a token older than 10 minutes gets 403 REAUTH_REQUIRED and nothing changes', async () => {
        User.__store.get(UID).passwordSet = false;
        const now = Math.floor(Date.now() / 1000);
        const stale = await run(authRoutes, 'post', '/password', { token: tokenFor({ iat: now - 11 * 60 }), body: { newPassword: NEW_PW } });
        expect(stale.status).toBe(403);
        expect(stale.body).toMatchObject({ success: false, code: 'REAUTH_REQUIRED' });
        expect(stored().passwordSet).toBe(false);
        expect(stored().tokenVersion).toBe(0);
        const fresh = await run(authRoutes, 'post', '/password', { token: tokenFor({ iat: now - 9 * 60 }), body: { newPassword: NEW_PW } });
        expect(fresh.status).toBe(200);
    });
    test('live /alerts sockets are kicked after password change, logout-all and account deletion', async () => {
        await auth('post', '/logout-all');
        expect(alertService.kick).toHaveBeenCalledWith(UID);
        alertService.kick.mockClear();
        await run(authRoutes, 'post', '/password', { token: tokenFor({ tv: 1 }), body: { currentPassword: OLD_PW, newPassword: NEW_PW } });
        expect(alertService.kick).toHaveBeenCalledWith(UID);
        alertService.kick.mockClear();
        alertService.kick.mockImplementation(() => { throw new Error('socket down'); }); // best effort: a failure must not fail the request
        const del = await run(authRoutes, 'delete', '/me', { token: tokenFor({ tv: 2 }), body: { confirmEmail: 'alice@x.io' } });
        expect(del.status).toBe(200);
        expect(alertService.kick).toHaveBeenCalledWith(UID);
        alertService.kick.mockReset();
    });
    test('a normal account cannot use the no-current-password path', async () => {
        const res = await auth('post', '/password', { body: { newPassword: NEW_PW } });
        expect(res.status).toBe(422);
        expect(await bcrypt.compare(OLD_PW, stored().password)).toBe(true);
    });
});

describe('API keys: encrypted at rest, never returned', () => {
    test('PUT stores AES-GCM ciphertext bound to user+provider, returns only keySet/keyLast4; DELETE removes it', async () => {
        const res = await aiApi('put', '/keys/:provider', { params: { provider: 'openai' }, body: { apiKey: KEY } });
        expect(res.body).toEqual({ provider: 'openai', keySet: true, keyLast4: KEY.slice(-4) });
        const enc = stored().ai.providers.openai.keyEnc;
        expect(enc).not.toContain(KEY);
        expect(secretBox.decrypt(enc, UID, 'openai')).toBe(KEY);
        expect(() => secretBox.decrypt(enc, UID, 'anthropic')).toThrow();
        const del = await aiApi('delete', '/keys/:provider', { params: { provider: 'openai' } });
        expect(del.body).toEqual({ provider: 'openai', keySet: false, keyLast4: null });
        expect(stored().ai.providers.openai.keyEnc).toBeUndefined();
        expect(stored().ai.providers.openai.keyLast4).toBeUndefined();
    });
    test.each([['short'], ['has a space in it'], ['x'.repeat(301)], [5], [null], [undefined]])('apiKey %p -> 400', async (apiKey) => {
        expect((await aiApi('put', '/keys/:provider', { params: { provider: 'openai' }, body: { apiKey } })).status).toBe(400);
    });
    test('unknown provider -> 400 (default has no key to store)', async () => {
        for (const provider of ['default', 'evil', '__proto__']) {
            expect((await aiApi('put', '/keys/:provider', { params: { provider }, body: { apiKey: KEY } })).status).toBe(400);
            expect((await aiApi('delete', '/keys/:provider', { params: { provider } })).status).toBe(400);
        }
    });

    test('the plaintext key and the ciphertext appear in no response: PUT, GET /me, PATCH /me, export, status', async () => {
        const put = await aiApi('put', '/keys/:provider', { params: { provider: 'openai' }, body: { apiKey: KEY } });
        const enc = stored().ai.providers.openai.keyEnc;
        await patch({ ai: { provider: 'openai', providers: { openai: { model: 'gpt-5' } } } });
        const bodies = [put.body, (await auth('get', '/me')).body, (await patch({ name: 'Alice B' })).body, (await auth('get', '/me/export')).body, (await aiApi('get', '/status')).body];
        for (const b of bodies) {
            const s = JSON.stringify(b);
            expect(s).not.toContain(KEY);
            expect(s).not.toContain(enc);
            expect(s).not.toMatch(/keyEnc|"password"|tokenVersion/);
        }
        const me = bodies[1].user.ai.providers.openai;
        expect(me).toEqual({ model: 'gpt-5', keySet: true, keyLast4: KEY.slice(-4) });
        expect(JSON.stringify(bodies[3])).not.toContain(KEY.slice(-4)); // export carries nothing key-derived
        expect(bodies[3].user.ai.providers.openai).toEqual({ model: 'gpt-5', keySet: true });
        expect(bodies[4]).toEqual({ configured: true, model: 'gpt-5', provider: 'openai' });
    });
});

describe('export', () => {
    test('contains the user data and nothing secret', async () => {
        const o = (n) => ({ userId: UID, n });
        models.Trade.__rows.push({ ...o(1), __v: 0, cryptoSymbol: 'BTC' }, { userId: UID2, cryptoSymbol: 'ETH' });
        models.Order.__rows.push(o(2)); models.Position.__rows.push(o(3)); models.FuturesOrder.__rows.push(o(4)); models.Alert.__rows.push(o(5)); models.Strategy.__rows.push(o(6), { userId: UID2, n: 7 }); models.AiConversation.__rows.push({ ...o(8), __v: 0 }, { userId: UID2, n: 9 });
        models.FuturesOp.__rows.push({ userId: UID, kind: 'open' });
        User.__store.get(UID).holdings = { BTC: 1.5 };
        const res = await auth('get', '/me/export');
        expect(res.status).toBe(200);
        expect(res.headers['Content-Disposition']).toBe('attachment; filename="cryptozen-export.json"');
        const b = res.body;
        expect(Object.keys(b).sort()).toEqual(['aiConversations', 'alerts', 'exportedAt', 'futuresOrders', 'note', 'orders', 'positions', 'strategies', 'trades', 'user']);
        expect(b.strategies).toEqual([{ userId: UID, n: 6 }]);
        expect(b.aiConversations).toEqual([{ userId: UID, n: 8 }]); // own rows only, __v stripped
        expect(b.note).toMatch(/paper/i);
        expect(b.note).toMatch(/no real money/i);
        expect(b.user).toMatchObject({ email: 'alice@x.io', balance: 100000, holdings: { BTC: 1.5 }, security: { googleLinked: true } });
        expect(b.trades).toEqual([{ userId: UID, n: 1, cryptoSymbol: 'BTC' }]); // __v stripped, other users' rows excluded
        expect([b.orders.length, b.positions.length, b.futuresOrders.length, b.alerts.length]).toEqual([1, 1, 1, 1]);
        const s = JSON.stringify(b);
        for (const secret of ['"password"', 'tokenVersion', 'futuresOps', 'googleId', 'g-123', 'keyEnc', 'keyLast4', '__v', stored().password]) expect(s).not.toContain(secret);
    });
});

describe('delete account', () => {
    const del = (confirmEmail = 'alice@x.io') => auth('delete', '/me', { body: { confirmEmail } });
    const seedAll = () => {
        for (const n of ['Trade', 'Order', 'Position', 'FuturesOrder', 'FuturesOp', 'Alert', 'AlertEvent', 'Strategy', 'AiConversation']) {
            models[n].__rows.push({ userId: UID, status: 'closed', kind: 'x' }, { userId: UID2, status: 'closed', kind: 'x' });
        }
    };

    test('wrong or missing confirmation email -> 422, nothing deleted or locked', async () => {
        seedAll();
        expect((await del('bob@x.io')).status).toBe(422);
        expect((await auth('delete', '/me', { body: {} })).status).toBe(422);
        expect((await auth('delete', '/me', { body: { confirmEmail: { $ne: '' } } })).status).toBe(422);
        expect(stored().lockedAt).toBeUndefined();
        expect(models.Trade.__rows).toHaveLength(2);
    });

    test('200 deletes the user and every collection for that user only; confirmation is case-insensitive', async () => {
        seedAll();
        const res = await del('ALICE@X.IO');
        expect(res).toMatchObject({ status: 200, body: { success: true } });
        expect(User.__store.has(UID)).toBe(false);
        for (const m of Object.values(models)) expect(m.__rows.map((r) => String(r.userId))).toEqual([UID2]);
        expect((await auth('get', '/me')).status).toBe(401); // the token is dead
    });

    test.each([
        ['an open position', 'Position', { status: 'open' }], ['an opening position', 'Position', { status: 'opening' }],
        ['a placing futures order', 'FuturesOrder', { status: 'placing' }], ['an open futures order', 'FuturesOrder', { status: 'open' }],
        ['a pending futures op', 'FuturesOp', { status: 'pending' }], ['an errored futures op', 'FuturesOp', { status: 'error' }],
    ])('%s -> 409 OPEN_FUTURES, nothing deleted, account unlocked again', async (name, model, row) => {
        seedAll();
        models[model].__rows.push({ userId: UID, ...row });
        const before = Object.values(models).map((m) => m.__rows.length);
        const res = await del();
        expect(res.status).toBe(409);
        expect(res.body).toEqual({ success: false, code: 'OPEN_FUTURES', message: 'Close your open futures positions and cancel pending futures orders first.' });
        expect(User.__store.has(UID)).toBe(true);
        expect(stored().lockedAt).toBeUndefined();
        expect(Object.values(models).map((m) => m.__rows.length)).toEqual(before);
        expect((await auth('get', '/me')).status).toBe(200); // usable again
        models[model].__rows.pop(); // close it
        expect((await del()).status).toBe(200);
    });

    test('closed/filled/cancelled futures rows do not block deletion', async () => {
        models.Position.__rows.push({ userId: UID, status: 'liquidated' }, { userId: UID, status: 'closed' });
        models.FuturesOrder.__rows.push({ userId: UID, status: 'filled' }, { userId: UID, status: 'cancelled' });
        models.FuturesOp.__rows.push({ userId: UID, status: 'done' }, { userId: UID, status: 'rolled_back' });
        expect((await del()).status).toBe(200);
    });

    test('race-safe: the account is locked BEFORE the guard runs, so a concurrent request is rejected while it runs', async () => {
        let lockedDuringCheck = null;
        const orig = models.Position.exists;
        models.Position.exists = async (f) => { lockedDuringCheck = !!stored().lockedAt; return orig(f); };
        try { expect((await del()).status).toBe(200); } finally { models.Position.exists = orig; }
        expect(lockedDuringCheck).toBe(true);
    });

    test('a failed deletion leaves the account locked (never half-usable) and reports 500', async () => {
        const orig = models.Order.deleteMany;
        models.Order.deleteMany = async () => { throw new Error('boom'); };
        try { expect((await del()).status).toBe(500); } finally { models.Order.deleteMany = orig; }
        expect(stored().lockedAt).toBeInstanceOf(Date);
    });
});

describe('AI routes: settings, scoping and budgets', () => {
    afterEach(() => jest.restoreAllMocks());

    test('POST /test: provider validation, no key -> ai_no_key, real call uses the saved key/model and reports latency', async () => {
        expect((await aiApi('post', '/test', { body: { provider: 'evil' } })).status).toBe(400);
        const none = await aiApi('post', '/test', { body: { provider: 'openai' } });
        expect(none).toMatchObject({ status: 400, body: { error: 'ai_no_key' } });
        await aiApi('put', '/keys/:provider', { params: { provider: 'openai' }, body: { apiKey: KEY } });
        await patch({ ai: { providers: { openai: { model: 'gpt-5' } } } });
        const spy = jest.spyOn(providers, 'complete').mockResolvedValue('OK');
        const res = await aiApi('post', '/test', { body: { provider: 'openai' } });
        expect(res.body).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-5' });
        expect(res.body.latencyMs).toEqual(expect.any(Number));
        expect(spy.mock.calls[0][0]).toMatchObject({ provider: 'openai', apiKey: KEY, model: 'gpt-5', system: 'Reply with OK.', user: 'ping', maxTokens: 16 });
        expect(JSON.stringify(res.body)).not.toContain(KEY);
    });

    test('an undecryptable saved key surfaces as ai_key_unreadable (409), not a 500', async () => {
        await aiApi('put', '/keys/:provider', { params: { provider: 'openai' }, body: { apiKey: KEY } });
        stored().ai.providers.openai.keyEnc = secretBox.encrypt(KEY, UID2, 'openai'); // as if copied from another user / rotated key
        const res = await aiApi('post', '/test', { body: { provider: 'openai' } });
        expect(res).toMatchObject({ status: 409, body: { error: 'ai_key_unreadable' } });
    });

    test('brief cache: a BYO result is never served to another user; shared default results are shared; style changes the key', async () => {
        const brief = jest.spyOn(ai, 'brief').mockImplementation(async (sym, s) => ({ for: s.userId, provider: s.provider }));
        User.__seed({ _id: UID2, username: 'bob', email: 'bob@x.io', name: 'Bob', password: 'x' });
        const get = (uid) => run(aiRoutes, 'get', '/brief/:symbol', { token: tokenFor({}, uid), params: { symbol: 'BTCUSDT' } });
        const asAlice = (s) => User.__store.get(UID).ai && Object.assign(User.__store.get(UID).ai, s);
        // both default, same style: one call, shared
        await get(UID); await get(UID2);
        expect(brief).toHaveBeenCalledTimes(1);
        // alice goes BYO: separate computation, and bob does not get it
        asAlice({ provider: 'openai' });
        const a = await get(UID);
        expect(a.body.brief).toMatchObject({ for: UID, provider: 'openai' });
        expect((await get(UID2)).body.brief).toMatchObject({ provider: 'default' });
        // portfolio consent on the default provider is per-user as well
        asAlice({ provider: 'default', includePortfolio: true });
        expect((await get(UID)).body.brief.for).toBe(UID);
        await get(UID); // cached for alice
        const calls = brief.mock.calls.length;
        // different style prompt / length -> different key
        asAlice({ includePortfolio: false, systemPrompt: 'be poetic' });
        await get(UID);
        asAlice({ length: 'short' });
        await get(UID);
        expect(brief.mock.calls.length).toBe(calls + 2);
    });

    test('process budget applies to the default provider only; the per-user limiter applies to all', async () => {
        const spend = jest.spyOn(ai, 'spend').mockReturnValue(0);
        jest.spyOn(ai, 'parseAlert').mockResolvedValue({ parsed: true, reason: '', symbol: 'BTCUSDT', metric: 'price', op: 'above', value: 1, note: '' });
        await aiApi('post', '/alerts/parse', { body: { text: 'btc above 1' } });
        expect(spend).toHaveBeenCalledTimes(1);
        Object.assign(User.__store.get(UID).ai, { provider: 'openai' });
        await aiApi('post', '/alerts/parse', { body: { text: 'btc above 1' } });
        expect(spend).toHaveBeenCalledTimes(1); // BYO call: not counted against the server budget
    });

    test('GET /status reports the user provider and whether it is configured', async () => {
        Object.assign(User.__store.get(UID).ai, { provider: 'custom' });
        expect((await aiApi('get', '/status')).body).toMatchObject({ configured: false, provider: 'custom' });
        await aiApi('put', '/keys/:provider', { params: { provider: 'custom' }, body: { apiKey: KEY } });
        expect((await aiApi('get', '/status')).body.configured).toBe(false); // custom also needs a base URL
        await patch({ ai: { providers: { custom: { baseUrl: 'https://llm.example.com/v1', model: 'm' } } } });
        expect((await aiApi('get', '/status')).body).toEqual({ configured: true, model: 'm', provider: 'custom' });
    });
});

describe('LM Studio provider: settings, status, test, models', () => {
    afterEach(() => { jest.restoreAllMocks(); process.env.NODE_ENV = 'test'; delete process.env.ALLOW_LOCAL_LLM; });
    // AI calls are rate limited per user across this file, so the limited routes run as a fresh user.
    const UID3 = '64b7f0c2a1b2c3d4e5f6071a';
    const lmApi = (m, p, o = {}) => run(aiRoutes, m, p, { token: tokenFor({}, UID3), ...o });
    const lmUser = (ai) => User.__seed({ _id: UID3, username: 'carol', email: 'carol@x.io', name: 'Carol', password: 'x', ai });

    test('provider, model and base URL persist like the others; no key field is involved', async () => {
        const res = await patch({ ai: { provider: 'lmstudio', providers: { lmstudio: { model: 'qwen/qwen3.5-9b', baseUrl: 'http://127.0.0.1:1234/v1' } } } });
        expect(res.status).toBe(200);
        expect(res.body.user.ai.provider).toBe('lmstudio');
        expect(res.body.user.ai.providers.lmstudio).toEqual({ model: 'qwen/qwen3.5-9b', baseUrl: 'http://127.0.0.1:1234/v1', keySet: false, keyLast4: null });
        expect((await auth('get', '/me')).body.aiProviders.find((p) => p.id === 'lmstudio')).toMatchObject({ needsBaseUrl: true, needsKey: false, defaultBaseUrl: 'http://localhost:1234/v1' });
        expect((await patch({ ai: { providers: { lmstudio: { baseUrl: '' } } } })).body.user.ai.providers.lmstudio.baseUrl).toBe('');
    });

    test.each(['http://10.0.0.1:1234/v1', 'http://localhost@evil.com/v1', 'http://2130706433:1234/v1', 'http://[::ffff:127.0.0.1]:1234/v1', 'http://169.254.169.254/', 'http://localhost:1234//evil.com', 'https://api.example.com/v1', 'http://127.0.0.1.nip.io/v1'])('PATCH refuses lmstudio base URL %s', async (baseUrl) => {
        expect((await patch({ ai: { providers: { lmstudio: { baseUrl } } } })).status).toBe(422);
    });

    test('production refuses a localhost base URL unless ALLOW_LOCAL_LLM=true', async () => {
        process.env.NODE_ENV = 'production';
        const body = { ai: { providers: { lmstudio: { baseUrl: 'http://localhost:1234/v1' } } } };
        expect((await patch(body)).status).toBe(422);
        process.env.ALLOW_LOCAL_LLM = 'true';
        expect((await patch(body)).status).toBe(200);
    });

    test('status is configured with no key; test connection runs without a key and reports reasoning-budget errors', async () => {
        lmUser({ provider: 'lmstudio' });
        expect((await lmApi('get', '/status')).body).toEqual({ configured: true, model: 'qwen/qwen3.5-9b', provider: 'lmstudio' });
        const spy = jest.spyOn(providers, 'complete').mockResolvedValue('OK');
        expect((await lmApi('post', '/test', { body: { provider: 'lmstudio' } })).body).toMatchObject({ ok: true, provider: 'lmstudio', model: 'qwen/qwen3.5-9b' });
        expect(spy.mock.calls[0][0]).toMatchObject({ provider: 'lmstudio', apiKey: '', baseUrl: '' });
        spy.mockRejectedValue(new providers.AiError(502, 'ai_reasoning_budget'));
        expect(await lmApi('post', '/test', { body: { provider: 'lmstudio' } })).toMatchObject({ status: 502, body: { error: 'ai_reasoning_budget' } });
    });

    test('GET /lmstudio/models lists loaded chat models from the saved base URL', async () => {
        const http = require('http');
        const { EventEmitter } = require('events');
        lmUser({ providers: { lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1' } } });
        jest.spyOn(http, 'request').mockImplementation((opts, cb) => {
            const req = new EventEmitter();
            req.destroy = jest.fn();
            req.end = () => setImmediate(() => { const r = new EventEmitter(); r.statusCode = 200; cb(r); r.emit('data', Buffer.from(JSON.stringify({ data: [{ id: 'qwen/qwen3.5-9b' }, { id: 'text-embedding-nomic-embed-text-v1.5' }] }))); r.emit('end'); });
            return req;
        });
        expect((await lmApi('get', '/lmstudio/models')).body).toEqual({ models: ['qwen/qwen3.5-9b'] });
        expect(http.request.mock.calls[0][0]).toMatchObject({ method: 'GET', hostname: '127.0.0.1', port: '1234', path: '/v1/models' });
    });
});
