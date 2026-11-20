// Handler-level tests (no sockets): mocked req/res, mocked models and price sources.
jest.mock('../config/config', () => ({ jwt: { secret: 'x'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models/User', () => ({ findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findById: jest.fn() }));
// User.findById(...).select(...).lean() -> doc
const found = (doc) => ({ select: () => ({ lean: async () => doc }) });
jest.mock('../models/Trade', () => ({ create: jest.fn(), aggregate: jest.fn(), deleteOne: jest.fn(), find: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ isKnownSymbol: jest.fn(), overview: jest.fn() }));
jest.mock('../services/futuresService', () => ({ getMark: jest.fn() }));

const express = require('express');
const User = require('../models/User');
const Trade = require('../models/Trade');
const rest = require('../services/futuresRest');
const svc = require('../services/futuresService');
const { placeTrade } = require('../controllers/tradeController');
const auth = require('../middleware/auth');
const tradeRouter = require('../routes/tradeRoutes');

const UID = '64b7f0c2a1b2c3d4e5f60718';
const call = async (handler, req) => {
    const res = { statusCode: 200, headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.set = (k, v) => { res.headers[k] = v; return res; };
    await handler({ user: { userId: UID }, body: {}, query: {}, ...req }, res, (e) => { throw e; });
    return res;
};
const order = (body) => call(placeTrade, { body });
const MARK = 100;
const SYNCED = { holdingsSyncedAt: new Date(), balance: 500, holdings: {} };

beforeEach(() => {
    jest.resetAllMocks();
    rest.isKnownSymbol.mockResolvedValue(true);
    svc.getMark.mockReturnValue({ markPrice: MARK, ts: Date.now() });
    User.findById.mockReturnValue(found(SYNCED));
    User.findOneAndUpdate.mockResolvedValue({ balance: 500 });
    Trade.create.mockResolvedValue({ _id: 't1' });
});

test('no token -> 401 from the router auth middleware (trade routes require it)', async () => {
    const layer = tradeRouter.stack[0];
    expect(layer.handle).toBe(auth);
    const res = await call(auth, { user: undefined, headers: {} });
    expect(res.statusCode).toBe(401);
    // every route is registered after auth
    const paths = tradeRouter.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(paths).toEqual(['post /', 'get /portfolio', 'get /']);
});

test('body userId is ignored: the debit hits the token user', async () => {
    const res = await order({ userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', cryptoSymbol: 'BTC', type: 'buy', amount: 1 });
    expect(res.statusCode).toBe(201);
    expect(User.findOneAndUpdate.mock.calls[0][0]._id).toBe(UID);
    expect(Trade.create.mock.calls[0][0].userId).toBe(UID);
});

test.each([[-1], [0], [NaN], ['1'], [Infinity], [1e12], [null], [undefined]])('amount %p -> 400', async (amount) => {
    const res = await order({ cryptoSymbol: 'BTC', type: 'buy', amount });
    expect(res.statusCode).toBe(400);
    expect(Trade.create).not.toHaveBeenCalled();
});

test('bad type / symbol / unknown market -> 400', async () => {
    expect((await order({ cryptoSymbol: 'BTC', type: 'short', amount: 1 })).statusCode).toBe(400);
    expect((await order({ cryptoSymbol: 'btc', type: 'buy', amount: 1 })).statusCode).toBe(400);
    expect((await order({ cryptoSymbol: { $ne: 1 }, type: 'buy', amount: 1 })).statusCode).toBe(400);
    rest.isKnownSymbol.mockResolvedValue(false);
    expect((await order({ cryptoSymbol: 'ZZZ', type: 'buy', amount: 1 })).statusCode).toBe(400);
});

test('client price is ignored: fill uses the stubbed mark; fee charged on a buy', async () => {
    const res = await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 2, priceAtTrade: 1, price: 1 });
    expect(res.statusCode).toBe(201);
    expect(Trade.create.mock.calls[0][0]).toMatchObject({ priceAtTrade: MARK, fee: 0.2 });
    expect(User.findOneAndUpdate.mock.calls[0][1]).toEqual({ $inc: { balance: -200.2, 'holdings.BTC': 2 } }); // 200 + 0.1% fee
    expect(res.body.fill).toMatchObject({ price: MARK, fee: 0.2, total: 200.2 });
    expect(res.body.fill.priceAgeMs).toBeLessThan(1000);
});

test('no price available -> 503 and nothing written', async () => {
    svc.getMark.mockReturnValue(null);
    rest.overview.mockResolvedValue([{ symbol: 'ETHUSDT', markPrice: 5 }]);
    const res = await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 });
    expect(res.statusCode).toBe(503);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
});

test('stale ws mark falls back to the overview price', async () => {
    svc.getMark.mockReturnValue({ markPrice: 1, ts: Date.now() - 60000 });
    rest.overview.mockResolvedValue([{ symbol: 'BTCUSDT', markPrice: 50 }]);
    const res = await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 });
    expect(res.body.fill.price).toBe(50);
});

test('buy with insufficient balance -> 400 and no Trade written', async () => {
    User.findOneAndUpdate.mockResolvedValue(null); // conditional update matched nothing
    const res = await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Insufficient/);
    expect(User.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ balance: { $gte: 100.1 } });
    expect(Trade.create).not.toHaveBeenCalled();
});

test('buy: failed Trade insert restores the balance', async () => {
    Trade.create.mockRejectedValue(new Error('db down'));
    await expect(order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 })).rejects.toThrow('db down');
    expect(User.updateOne).toHaveBeenCalledWith({ _id: UID }, { $inc: { balance: 100.1, 'holdings.BTC': -1 } });
});

test('sell beyond holdings -> 400 "Cannot sell more than you hold", no Trade written', async () => {
    User.findOneAndUpdate.mockResolvedValue(null); // conditional update matched nothing
    const res = await order({ cryptoSymbol: 'BTC', type: 'sell', amount: 1.5 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Cannot sell more than you hold');
    expect(User.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ _id: UID, 'holdings.BTC': { $gte: expect.any(Number) } });
    expect(Trade.create).not.toHaveBeenCalled();
});

test('sell: one atomic update credits net of the 0.1% fee and removes the holding', async () => {
    User.findOneAndUpdate.mockResolvedValue({ balance: 1199.8 });
    const res = await order({ cryptoSymbol: 'BTC', type: 'sell', amount: 2 });
    expect(res.statusCode).toBe(201);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(User.findOneAndUpdate.mock.calls[0][1]).toEqual({ $inc: { balance: 199.8, 'holdings.BTC': -2 } }); // 200 - 0.2
    expect(Trade.create.mock.calls[0][0]).toMatchObject({ type: 'sell', fee: 0.2 });
    expect(res.body.balance).toBe(1199.8);
});

test('sell: failed Trade insert reverses balance and holding', async () => {
    Trade.create.mockRejectedValue(new Error('db down'));
    await expect(order({ cryptoSymbol: 'BTC', type: 'sell', amount: 2 })).rejects.toThrow('db down');
    expect(User.updateOne).toHaveBeenCalledWith({ _id: UID }, { $inc: { balance: -199.8, 'holdings.BTC': 2 } });
});

test('orders under $5 notional -> 400; amount is rounded to 8 dp', async () => {
    const small = await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 0.04 }); // $4
    expect(small.statusCode).toBe(400);
    expect(small.body.message).toMatch(/\$5/);
    expect(User.findOneAndUpdate).not.toHaveBeenCalled();
    await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 0.123456789123 });
    expect(Trade.create.mock.calls[0][0].amount).toBe(0.12345679);
    expect((await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1e-12 })).statusCode).toBe(400);
});

test('fill price: ws <= 3s, else futuresRest.markPrice, else overview, else 503', async () => {
    rest.markPrice = jest.fn();
    try {
        svc.getMark.mockReturnValue({ markPrice: 7, ts: Date.now() - 2000 });
        expect((await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 })).body.fill.price).toBe(7);
        expect(rest.markPrice).not.toHaveBeenCalled();

        svc.getMark.mockReturnValue({ markPrice: 7, ts: Date.now() - 4000 }); // too old
        rest.markPrice.mockResolvedValue({ markPrice: 8, ts: Date.now() - 500 });
        const r = await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 });
        expect(r.body.fill.price).toBe(8);
        expect(r.body.fill.priceAgeMs).toBeGreaterThanOrEqual(500);

        rest.markPrice.mockResolvedValue(null);
        rest.overview.mockResolvedValue([{ symbol: 'BTCUSDT', markPrice: 9, ts: Date.now() - 5000 }]);
        expect((await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 })).body.fill.price).toBe(9);

        rest.markPrice.mockRejectedValue(new Error('boom'));
        rest.overview.mockResolvedValue([{ symbol: 'BTCUSDT', markPrice: 9, ts: Date.now() - 11000 }]); // too old
        expect((await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 })).statusCode).toBe(503);
    } finally {
        delete rest.markPrice;
    }
});

test('first trade migrates holdings from Trade history once, clamped at >= 0', async () => {
    User.findById.mockReturnValue(found({ balance: 500 })); // no holdingsSyncedAt
    Trade.aggregate.mockResolvedValue([{ _id: 'BTC', net: 1.5 }, { _id: 'ETH', net: -2 }, { _id: 'BAD.X', net: 1 }]);
    await order({ cryptoSymbol: 'BTC', type: 'buy', amount: 1 });
    const [filter, update] = User.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: UID, holdingsSyncedAt: { $exists: false } });
    expect(update.$set.holdings).toEqual({ BTC: 1.5 });
    expect(update.$set.holdingsSyncedAt).toBeInstanceOf(Date);
});

test('portfolio: amounts from the User doc, dust hidden, avgCost from ordered trades', async () => {
    const { portfolio } = require('../controllers/tradeController');
    User.findById.mockReturnValue(found({ holdingsSyncedAt: new Date(), balance: 10, holdings: { BTC: 1, ETH: 1e-9 } }));
    Trade.find.mockReturnValue({ select: () => ({ lean: async () => [
        { cryptoSymbol: 'BTC', type: 'buy', amount: 1, priceAtTrade: 100, date: new Date(1) },
        { cryptoSymbol: 'BTC', type: 'sell', amount: 1, priceAtTrade: 150, date: new Date(2) },
        { cryptoSymbol: 'BTC', type: 'buy', amount: 1, priceAtTrade: 200, date: new Date(3) },
    ] }) });
    const res = await call(portfolio, {});
    expect(res.body.holdings).toEqual([{ symbol: 'BTC', amount: 1, avgCost: 200 }]);
});
