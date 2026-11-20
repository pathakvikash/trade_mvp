jest.mock('../config/config', () => ({ jwt: { secret: 'x'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models/User', () => ({ findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn(), PAPER_BALANCE: 100000 }));
jest.mock('../models/Trade', () => ({ exists: jest.fn() }));

const User = require('../models/User');
const Trade = require('../models/Trade');
const { registerUser, loginUser, lockLegacyAccounts, initializeDefaultUsers } = require('../controllers/authController');
const { createLimiter } = require('../middleware/rateLimit');
const { registerRules, loginRules, validate } = require('../middleware/validator');

const call = async (handler, body) => {
    const res = { statusCode: 200, headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.set = (k, v) => { res.headers[k] = v; return res; };
    await handler({ body }, res, (e) => { throw e; });
    return res;
};
// Runs the real express-validator chain + validate() and returns the response if it rejected, else null.
const validated = async (rules, body) => {
    const req = { body };
    for (const r of rules) await r.run(req);
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    let passed = false;
    validate(req, res, () => { passed = true; });
    return passed ? null : res;
};

beforeEach(() => jest.resetAllMocks());

test('register: role:admin in the body is ignored, the user is created as user', async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockImplementation(async (d) => ({ _id: 'u1', ...d }));
    const res = await call(registerUser, { username: 'Bob_1', email: 'B@x.io', password: 'longenough1', name: 'Bob', role: 'admin' });
    expect(res.statusCode).toBe(201);
    expect(User.create.mock.calls[0][0].role).toBe('user');
    expect(res.body.user.role).toBe('user');
});

test('register validation: missing fields, bad username, short password, object injection -> 422 (never a 500)', async () => {
    const ok = { username: 'bob_1', email: 'b@x.io', password: 'longenough1', name: 'Bob' };
    expect(await validated(registerRules(), ok)).toBeNull();
    for (const bad of [{}, { ...ok, username: 'a' }, { ...ok, username: 'bad name' }, { ...ok, password: 'short' }, { ...ok, name: '' }, { ...ok, email: { $gt: '' } }]) {
        expect((await validated(registerRules(), bad)).statusCode).toBe(422);
    }
});

test('login validation only requires a non-empty password (no 8-char rule)', async () => {
    expect(await validated(loginRules(), { email: 'b@x.io', password: 'x' })).toBeNull();
    expect((await validated(loginRules(), { email: 'b@x.io', password: '' })).statusCode).toBe(422);
});

test('login: unknown email and wrong password give the identical response', async () => {
    User.findOne.mockResolvedValueOnce(null);
    const unknown = await call(loginUser, { email: 'no@x.io', password: 'whatever1' });
    User.findOne.mockResolvedValueOnce({ matchPassword: async () => false });
    const wrong = await call(loginUser, { email: 'yes@x.io', password: 'whatever1' });
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.message).toBe('Invalid email or password');
});

test('login: zero-balance user with no trades gets the paper balance once', async () => {
    Trade.exists.mockResolvedValue(null);
    User.findOne.mockResolvedValue({ _id: 'u1', balance: 0, role: 'user', username: 'a', matchPassword: async () => true });
    const res = await call(loginUser, { email: 'a@x.io', password: 'pw' });
    expect(res.statusCode).toBe(200);
    expect(User.updateOne).toHaveBeenCalledWith({ _id: 'u1', balance: 0 }, { $set: { balance: 100000 } });
});

test('limiter: the 11th login within a minute is blocked with 429 + Retry-After', () => {
    const check = createLimiter({ limit: 10, windowMs: 60000 });
    const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    for (let i = 0; i < 10; i++) expect(check('1.2.3.4', res)).toBe(false);
    expect(check('1.2.3.4', res)).toBe(true);
    expect(res.code).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);
    expect(check('5.6.7.8', res)).toBe(false); // other IPs unaffected
});

test('login route is wired through a 10/min limiter', () => {
    const router = require('../routes/authRoutes');
    const login = router.stack.find((l) => l.route && l.route.path === '/login').route.stack.map((s) => s.name);
    expect(login[0]).toBeTruthy();
    const mw = router.stack.find((l) => l.route && l.route.path === '/login').route.stack[0].handle;
    const res = { headers: {}, set(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json() {} };
    let passed = 0;
    for (let i = 0; i < 11; i++) mw({ ip: '9.9.9.9' }, res, () => { passed++; });
    expect(passed).toBe(10);
    expect(res.code).toBe(429);
});

describe('legacy public accounts', () => {
    const env = { ...process.env };
    afterEach(() => { process.env = { ...env }; });
    const updated = () => User.updateOne.mock.calls.map((c) => c[0].email);

    test('seeding off: admin and guest are locked with a random hash, role user, lockedAt set', async () => {
        process.env.SEED_DEMO_USERS = 'false';
        User.updateOne.mockResolvedValue({ modifiedCount: 1 });
        await lockLegacyAccounts();
        expect(updated()).toEqual(['admin@cryptozen.com', 'guest@cryptozen.com']);
        for (const [filter, update] of User.updateOne.mock.calls) {
            expect(filter.lockedAt).toBeNull(); // only accounts not locked yet
            expect(update.$set).toMatchObject({ role: 'user', lockedAt: expect.any(Date) });
            expect(update.$set.password).toMatch(/^\$2[aby]\$/);
        }
        const [a, b] = User.updateOne.mock.calls.map((c) => c[1].$set.password);
        expect(a).not.toBe(b);
        expect(require('../config/logger').warn).toHaveBeenCalled();
    });

    test('seeding on with a valid env password: only the admin is locked; guest reset clears lockedAt', async () => {
        process.env.SEED_DEMO_USERS = 'true';
        process.env.DEMO_GUEST_PASSWORD = 'a-long-demo-password';
        User.updateOne.mockResolvedValue({ modifiedCount: 0 });
        await lockLegacyAccounts();
        expect(updated()).toEqual(['admin@cryptozen.com']);
        const guest = { role: 'admin', lockedAt: new Date(), save: jest.fn() };
        User.findOne.mockResolvedValue(guest);
        await initializeDefaultUsers();
        expect(guest).toMatchObject({ role: 'user', lockedAt: undefined, password: 'a-long-demo-password' });
        expect(guest.save).toHaveBeenCalled();
    });

    test('seeding on but password missing: the guest is still locked', async () => {
        process.env.SEED_DEMO_USERS = 'true';
        delete process.env.DEMO_GUEST_PASSWORD;
        User.updateOne.mockResolvedValue({ modifiedCount: 0 });
        await lockLegacyAccounts();
        expect(updated()).toContain('guest@cryptozen.com');
    });

    test('a locked account cannot log in even if the password matched', async () => {
        User.findOne.mockResolvedValue({ _id: 'u', lockedAt: new Date(), matchPassword: async () => true });
        expect((await call(loginUser, { email: 'a@x.io', password: 'pw' })).statusCode).toBe(401);
    });
});
