// Controller-level concurrency: a fake User model whose findOneAndUpdate applies the conditional $inc atomically
// (check and apply in one synchronous step, as MongoDB does for a single document).
jest.mock('../config/config', () => ({ jwt: { secret: 'x'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models/User', () => ({ findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findById: jest.fn() }));
jest.mock('../models/Trade', () => ({ create: jest.fn(), aggregate: jest.fn(), find: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ isKnownSymbol: jest.fn(async () => true), overview: jest.fn() }));
jest.mock('../services/futuresService', () => ({ getMark: jest.fn(() => ({ markPrice: 100, ts: Date.now() })) }));

const User = require('../models/User');
const Trade = require('../models/Trade');
const { placeTrade } = require('../controllers/tradeController');

const UID = '64b7f0c2a1b2c3d4e5f60718';
let doc;
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    doc = { balance: 1000, holdings: { BTC: 1 }, holdingsSyncedAt: new Date() };
    User.findById.mockReturnValue({ select: () => ({ lean: async () => { await tick(); return { ...doc }; } }) });
    User.findOneAndUpdate.mockImplementation(async (filter, update) => {
        await tick(); // other requests interleave here, before the atomic step
        for (const [k, cond] of Object.entries(filter)) {
            if (k === '_id') continue;
            const have = k.startsWith('holdings.') ? doc.holdings[k.slice(9)] : doc[k];
            if (!(have >= cond.$gte)) return null;
        }
        for (const [k, v] of Object.entries(update.$inc)) {
            if (k.startsWith('holdings.')) doc.holdings[k.slice(9)] = (doc.holdings[k.slice(9)] || 0) + v;
            else doc[k] += v;
        }
        return { balance: doc.balance };
    });
    Trade.create.mockImplementation(async () => { await tick(); return {}; });
});

const run = async (body) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await placeTrade({ user: { userId: UID }, body }, res, (e) => { throw e; });
    return res;
};

test('10 parallel sells of one holding: exactly one succeeds, balance credited once, holding 0', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => run({ cryptoSymbol: 'BTC', type: 'sell', amount: 1 })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 400)).toHaveLength(9);
    expect(doc.holdings.BTC).toBe(0);
    expect(doc.balance).toBeCloseTo(1000 + 99.9, 6); // one sale of 1 @ 100 minus the 0.1% fee
    expect(Trade.create).toHaveBeenCalledTimes(1);
});

test('parallel buys cannot overdraw the balance', async () => {
    doc.balance = 250;
    const results = await Promise.all(Array.from({ length: 10 }, () => run({ cryptoSymbol: 'ETH', type: 'buy', amount: 1 })));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(2); // 2 x 100.1 fits in 250, a third does not
    expect(doc.balance).toBeGreaterThanOrEqual(0);
    expect(doc.holdings.ETH).toBe(2);
});
