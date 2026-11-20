const jwt = require('jsonwebtoken');
jest.mock('../config/config', () => ({ jwt: { secret: 'k'.repeat(40) } }));
// auth loads the account on every request; a live, unlocked user passes.
jest.mock('../models/User', () => ({ findById: jest.fn() }));
const User = require('../models/User');
const auth = require('../middleware/auth');

const SECRET = 'k'.repeat(40);
beforeEach(() => {
    User.findById.mockReturnValue({ select: () => ({ lean: async () => ({ lockedAt: undefined, passwordChangedAt: undefined }) }) });
});

const run = async (token) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
    const req = { headers: { authorization: `Bearer ${token}` } };
    let passed = false;
    await auth(req, res, () => { passed = true; });
    return { passed, res, req };
};

test('valid HS256 token passes and sets req.user', async () => {
    const r = await run(jwt.sign({ userId: 'u1' }, SECRET, { algorithm: 'HS256', expiresIn: 60 }));
    expect(r.passed).toBe(true);
    expect(r.req.user.userId).toBe('u1');
});

test('expired token -> 401', async () => {
    const r = await run(jwt.sign({ userId: 'u1' }, SECRET, { algorithm: 'HS256', expiresIn: -10 }));
    expect(r.passed).toBe(false);
    expect(r.res.code).toBe(401);
});

test('token signed with another algorithm (HS512) or alg none -> 401', async () => {
    expect((await run(jwt.sign({ userId: 'u1' }, SECRET, { algorithm: 'HS512' }))).res.code).toBe(401);
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect((await run(`${b64({ alg: 'none', typ: 'JWT' })}.${b64({ userId: 'u1' })}.`)).res.code).toBe(401);
});

test('token signed with the wrong secret -> 401', async () => {
    expect((await run(jwt.sign({ userId: 'u1' }, 'z'.repeat(40), { algorithm: 'HS256' }))).res.code).toBe(401);
});

test('user missing or locked -> 401 even with a valid signature', async () => {
    const token = jwt.sign({ userId: 'u1' }, SECRET, { algorithm: 'HS256', expiresIn: 60 });
    User.findById.mockReturnValueOnce({ select: () => ({ lean: async () => null }) });
    expect((await run(token)).res.code).toBe(401);
    User.findById.mockReturnValueOnce({ select: () => ({ lean: async () => ({ lockedAt: new Date() }) }) });
    expect((await run(token)).res.code).toBe(401);
});
