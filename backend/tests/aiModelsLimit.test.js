// POST /api/ai/models: 10 per minute per user, enforced by the real limiter (settingsOverhaul mocks it out).
jest.mock('../config/config', () => ({ jwt: { secret: 'k'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../middleware/auth', () => (req, res, next) => { req.user = { userId: req.headers.uid }; next(); });
jest.mock('../models/User', () => ({ findById: () => ({ select: () => ({ lean: async () => ({}) }) }) }));
const providers = require('../services/aiProviders');
const router = require('../routes/aiRoutes');

test('11th call in a minute gets 429, another user is unaffected', async () => {
    jest.spyOn(providers, 'listModels').mockResolvedValue([]);
    const layer = router.stack.find((l) => l.route && l.route.path === '/models');
    const call = (uid) => new Promise((resolve) => {
        const res = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json() { resolve(this.statusCode); } };
        const req = { headers: { uid }, body: { provider: 'openai', apiKey: 'sk-test-12345678' }, user: { userId: uid } };
        const [limit, handler] = layer.route.stack.map((l) => l.handle);
        limit(req, res, () => handler(req, res));
    });
    const out = [];
    for (let i = 0; i < 11; i++) out.push(await call('u1'));
    expect(out.filter((s) => s === 200)).toHaveLength(10);
    expect(out[10]).toBe(429);
    expect(await call('u2')).toBe(200);
});
