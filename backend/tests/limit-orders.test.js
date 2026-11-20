// Limit orders end to end at handler level: in-memory fakes of User / Order / Trade that apply conditional updates
// atomically (check + apply in one synchronous step, as MongoDB does for one document).
jest.mock('../config/config', () => ({ jwt: { secret: 'x'.repeat(40) } }));
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models/User', () => ({ findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findById: jest.fn() }));
jest.mock('../models/Trade', () => ({ create: jest.fn(), aggregate: jest.fn(), find: jest.fn() }));
jest.mock('../models/Order', () => ({ create: jest.fn(), find: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ isKnownSymbol: jest.fn(async () => true), overview: jest.fn(async () => []) }));
jest.mock('../services/futuresService', () => ({ getMark: jest.fn() }));

const User = require('../models/User');
const Trade = require('../models/Trade');
const Order = require('../models/Order');
const svc = require('../services/futuresService');
const { placeTrade } = require('../controllers/tradeController');
const { listOrders, cancelOrder } = require('../controllers/orderController');
const matcher = require('../services/orderMatcher');
const { placeTradeRules, validate } = require('../middleware/validator');

const A = '64b7f0c2a1b2c3d4e5f60718';
const B = '64b7f0c2a1b2c3d4e5f60719';
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const set = (o, path, fn) => {
    const ks = path.split('.');
    const last = ks.pop();
    const t = ks.reduce((x, k) => (x[k] = x[k] || {}), o);
    t[last] = fn(t[last]);
};
const matches = (doc, filter) => Object.entries(filter).every(([k, c]) => {
    const v = k === '_id' || k === 'userId' ? String(get(doc, k)) : get(doc, k);
    if (c && typeof c === 'object' && !(c instanceof Date)) {
        if ('$in' in c) return c.$in.map(String).includes(String(v));
        if ('$gte' in c) return v >= c.$gte;
        if ('$ne' in c) return v !== c.$ne;
        return false;
    }
    return v === (k === '_id' || k === 'userId' ? String(c) : c);
});
const apply = (doc, upd) => {
    for (const [k, d] of Object.entries(upd.$inc || {})) set(doc, k, (x) => (x || 0) + d);
    for (const [k, v] of Object.entries(upd.$set || {})) set(doc, k, () => v);
    for (const k of Object.keys(upd.$unset || {})) delete doc[k];
};
const chain = (rows) => {
    let r = rows;
    const c = { sort: () => { r = [...r].reverse(); return c; }, limit: (n) => { r = r.slice(0, n); return c; }, select: () => c, lean: () => c, then: (res, rej) => Promise.resolve(r.map((x) => ({ ...x }))).then(res, rej) };
    return c;
};

let users;
let orders;
let trades;
let seq;
let fail; // flip to make the fake Trade insert throw

beforeEach(() => {
    jest.resetAllMocks();
    users = { [A]: { balance: 1000, holdings: { BTC: 2 }, holdingsSyncedAt: new Date() }, [B]: { balance: 1000, holdings: {}, holdingsSyncedAt: new Date() } };
    orders = [];
    trades = [];
    seq = 0;
    fail = false;
    const { isKnownSymbol } = require('../services/futuresRest');
    isKnownSymbol.mockResolvedValue(true);
    svc.getMark.mockReturnValue({ markPrice: 100, ts: Date.now() });
    User.findById.mockImplementation((id) => ({ select: () => ({ lean: async () => ({ ...users[String(id)] }) }) }));
    User.findOneAndUpdate.mockImplementation(async (f, upd) => {
        await Promise.resolve();
        const u = users[String(f._id)];
        if (!u || !matches(u, Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_id')))) return null;
        apply(u, upd);
        return { balance: u.balance };
    });
    User.updateOne.mockImplementation(async (f, upd) => { apply(users[String(f._id)], upd); });
    Trade.create.mockImplementation(async (d) => { if (fail) throw new Error('boom'); trades.push(d); return d; });
    Trade.find.mockImplementation((f) => chain(trades.filter((t) => matches(t, f))));
    Order.countDocuments.mockImplementation(async (f) => orders.filter((o) => matches(o, f)).length);
    Order.create.mockImplementation(async (d) => { const o = { _id: String(++seq).padStart(24, 'a'), status: 'open', createdAt: new Date(), ...d }; orders.push(o); return o; });
    Order.find.mockImplementation((f) => chain(orders.filter((o) => matches(o, f))));
    Order.findOne.mockImplementation((f) => ({ select: () => ({ lean: async () => orders.find((o) => matches(o, f)) || null }) }));
    Order.findOneAndUpdate.mockImplementation(async (f, upd) => {
        await Promise.resolve();
        const o = orders.find((x) => matches(x, f));
        if (!o) return null;
        apply(o, upd);
        return o;
    });
    Order.updateOne.mockImplementation(async (f, upd) => { const o = orders.find((x) => matches(x, f)); if (o) apply(o, upd); });
});

const call = async (handler, req) => {
    const res = { statusCode: 200 };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    await handler({ user: { userId: A }, body: {}, query: {}, params: {}, ...req }, res, (e) => { throw e; });
    return res;
};
const limit = (over = {}, user = A) => call(placeTrade, { user: { userId: user }, body: { cryptoSymbol: 'BTC', type: 'buy', amount: 1, orderType: 'limit', limitPrice: 90, ...over } });
const cancel = (id, user = A) => call(cancelOrder, { user: { userId: user }, params: { id } });

test('buy limit: reserves amount*price + 0.1% fee, stores an open order, no trade yet', async () => {
    const res = await limit();
    expect(res.statusCode).toBe(201);
    expect(res.body.order).toMatchObject({ symbol: 'BTC', side: 'buy', amount: 1, limitPrice: 90, status: 'open', reserved: 90.09 });
    expect(users[A].balance).toBeCloseTo(1000 - 90.09, 6);
    expect(users[A].holdings.BTC).toBe(2);
    expect(trades).toHaveLength(0);
});

test('sell limit: reserves the coins so they cannot be sold twice', async () => {
    expect((await limit({ type: 'sell', amount: 2, limitPrice: 120 })).statusCode).toBe(201);
    expect(users[A].holdings.BTC).toBe(0);
    const again = await limit({ type: 'sell', amount: 1, limitPrice: 120 });
    expect(again.statusCode).toBe(400);
    const market = await call(placeTrade, { body: { cryptoSymbol: 'BTC', type: 'sell', amount: 1 } });
    expect(market.statusCode).toBe(400);
});

test('insufficient funds -> 400, nothing reserved, no order', async () => {
    const res = await limit({ amount: 100, limitPrice: 90 });
    expect(res.statusCode).toBe(400);
    expect(users[A].balance).toBe(1000);
    expect(orders).toHaveLength(0);
});

test('cancel releases the reservation; second cancel is 409', async () => {
    const { body } = await limit();
    const id = String(body.order._id);
    const res = await cancel(id);
    expect(res.statusCode).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
    expect(users[A].balance).toBeCloseTo(1000, 6);
    expect((await cancel(id)).statusCode).toBe(409);
    expect(users[A].balance).toBeCloseTo(1000, 6);
});

test('cancel of a sell returns the coins', async () => {
    const { body } = await limit({ type: 'sell', amount: 1, limitPrice: 150 });
    await cancel(String(body.order._id));
    expect(users[A].holdings.BTC).toBe(2);
});

test("another user's order -> 404 and is untouched; bad id -> 404", async () => {
    const { body } = await limit();
    const res = await cancel(String(body.order._id), B);
    expect(res.statusCode).toBe(404);
    expect(orders[0].status).toBe('open');
    expect((await cancel('nope')).statusCode).toBe(404);
    expect(users[B].balance).toBe(1000);
});

test('max 20 open orders', async () => {
    users[A].balance = 1e6;
    for (let i = 0; i < 20; i++) expect((await limit({ amount: 0.1 })).statusCode).toBe(201);
    const res = await limit({ amount: 0.1 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/20/);
    expect(orders).toHaveLength(20);
});

test('list returns own open orders and closed ones', async () => {
    await limit();
    await limit({ amount: 0.5 });
    await cancel(String(orders[0]._id));
    await limit({}, B);
    const res = await call(listOrders, {});
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.closed).toHaveLength(1);
    expect(res.body.orders.every((o) => String(o.userId) === A)).toBe(true);
});

test('matcher fills a buy at the LIMIT price when mark <= limit, once, charging the fee; skips when not crossed', async () => {
    await limit({ limitPrice: 90 });
    await matcher.runOnce(); // mark 100 > 90
    expect(orders[0].status).toBe('open');
    svc.getMark.mockReturnValue({ markPrice: 85, ts: Date.now() });
    await matcher.runOnce();
    await matcher.runOnce();
    expect(orders[0]).toMatchObject({ status: 'filled', fillPrice: 90 });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ type: 'buy', amount: 1, priceAtTrade: 90, fee: 0.09, cryptoSymbol: 'BTC' });
    expect(users[A].holdings.BTC).toBe(3);
    expect(users[A].balance).toBeCloseTo(1000 - 90.09, 6);
});

test('matcher fills a sell at the limit price when mark >= limit', async () => {
    await limit({ type: 'sell', amount: 1, limitPrice: 110 });
    svc.getMark.mockReturnValue({ markPrice: 120, ts: Date.now() });
    await matcher.runOnce();
    expect(orders[0]).toMatchObject({ status: 'filled', fillPrice: 110 });
    expect(trades[0]).toMatchObject({ type: 'sell', priceAtTrade: 110, fee: 0.11 });
    expect(users[A].balance).toBeCloseTo(1000 + 109.89, 6); // 110 - 0.1% fee
    expect(users[A].holdings.BTC).toBe(1);
});

test('concurrent fills of one order settle exactly once', async () => {
    await limit({ limitPrice: 90 });
    await Promise.all([matcher._test.fillOrder(orders[0]), matcher._test.fillOrder(orders[0]), matcher._test.fillOrder(orders[0])]);
    expect(trades).toHaveLength(1);
    expect(users[A].holdings.BTC).toBe(3);
});

test('a cancelled order is never filled', async () => {
    const { body } = await limit({ limitPrice: 90 });
    await cancel(String(body.order._id));
    svc.getMark.mockReturnValue({ markPrice: 50, ts: Date.now() });
    await matcher.runOnce();
    expect(trades).toHaveLength(0);
    expect(users[A].balance).toBeCloseTo(1000, 6);
});

test('missing or stale price is skipped; a failed trade insert reverses and reopens the order', async () => {
    await limit({ limitPrice: 90 });
    svc.getMark.mockReturnValue(null);
    await matcher.runOnce();
    expect(orders[0].status).toBe('open');
    svc.getMark.mockReturnValue({ markPrice: 80, ts: Date.now() });
    fail = true;
    await matcher.runOnce();
    expect(orders[0].status).toBe('open');
    expect(users[A].holdings.BTC).toBe(2);
    expect(users[A].balance).toBeCloseTo(1000 - 90.09, 6);
    fail = false;
    await matcher.runOnce();
    expect(orders[0].status).toBe('filled');
});

const logged = (re) => require('../config/logger').error.mock.calls.filter(([m]) => re.test(m));

test('compensation failure parks the order as error: never reopened, never settled twice', async () => {
    await limit({ limitPrice: 90 });
    svc.getMark.mockReturnValue({ markPrice: 80, ts: Date.now() });
    fail = true;
    User.updateOne.mockImplementation(async () => { throw new Error('db down'); });
    await matcher.runOnce();
    expect(orders[0].status).toBe('error');
    expect(logged(/parked as error/)[0][0]).toContain(orders[0]._id);
    expect(logged(/parked as error/)[0][0]).toContain(A);
    fail = false;
    await matcher.runOnce();
    await matcher.runOnce();
    expect(orders[0].status).toBe('error');
    expect(trades).toHaveLength(0);
    expect(users[A].holdings.BTC).toBe(3); // credited once by the unreversed settle, not again
});

test('3 consecutive clean failures reject the order and refund the reservation exactly once', async () => {
    await limit({ limitPrice: 90 });
    svc.getMark.mockReturnValue({ markPrice: 80, ts: Date.now() });
    fail = true;
    await matcher.runOnce();
    await matcher.runOnce();
    expect(orders[0]).toMatchObject({ status: 'open', failures: 2 });
    await matcher.runOnce();
    expect(orders[0]).toMatchObject({ status: 'rejected', failures: 3 });
    expect(users[A].balance).toBeCloseTo(1000, 6);
    await matcher.runOnce();
    expect(users[A].balance).toBeCloseTo(1000, 6);
    expect(users[A].holdings.BTC).toBe(2);
});

test('3 failures on a sell return the coins', async () => {
    await limit({ type: 'sell', amount: 1, limitPrice: 110 });
    svc.getMark.mockReturnValue({ markPrice: 120, ts: Date.now() });
    fail = true;
    for (let i = 0; i < 3; i++) await matcher.runOnce();
    expect(orders[0].status).toBe('rejected');
    expect(users[A].holdings.BTC).toBe(2);
    expect(users[A].balance).toBeCloseTo(1000, 6);
});

test('a failed reopen is logged with the order id', async () => {
    await limit({ limitPrice: 90 });
    fail = true;
    const orig = Order.findOneAndUpdate.getMockImplementation();
    Order.findOneAndUpdate.mockImplementation(async (f, upd) => {
        if (f.status === 'filled') throw new Error('db gone');
        return orig(f, upd);
    });
    await matcher._test.fillOrder(orders[0]);
    expect(logged(/could not reopen/)[0][0]).toContain(orders[0]._id);
});

test('a pass over more orders than the cap fills the oldest 1000 and finishes the rest next pass', async () => {
    users[A].balance = 1e6;
    for (let i = 0; i < 1200; i++) orders.push({ _id: String(i + 1).padStart(24, 'b'), userId: A, symbol: 'BTC', side: 'buy', amount: 0.001, limitPrice: 200, reserved: 0.2, status: 'open', createdAt: new Date(i) });
    await matcher.runOnce();
    expect(orders.filter((o) => o.status === 'filled')).toHaveLength(1000);
    svc.getMark.mockReturnValue({ markPrice: 100, ts: Date.now() }); // a slow first pass must not age the mark past the 3s freshness gate
    await matcher.runOnce();
    expect(orders.filter((o) => o.status === 'filled')).toHaveLength(1200);
});

test('stop() resolves only after the in-flight pass finishes', async () => {
    Order.find.mockImplementationOnce(() => {
        const c = chain([]);
        const then = c.then;
        c.then = (res, rej) => new Promise((r) => setTimeout(r, 50)).then(() => then(res, rej));
        return c;
    });
    const pass = matcher.runOnce();
    let stopped = false;
    const p = matcher.stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(stopped).toBe(false);
    await pass;
    await p;
    expect(stopped).toBe(true);
    await expect(matcher.stop()).resolves.toBeUndefined(); // idle: resolves at once
});

test('startup sweep logs filled orders without a Trade (last 24h only) and changes no balances', async () => {
    const mk = (id, filledAt) => orders.push({ _id: id.padStart(24, 'c'), userId: A, symbol: 'BTC', side: 'buy', amount: 1, limitPrice: 90, reserved: 90.09, status: 'filled', filledAt });
    mk('1', new Date()); // has a trade
    mk('2', new Date()); // orphan
    mk('3', new Date(Date.now() - 48 * 3600 * 1000)); // too old to look at
    trades.push({ userId: A, orderId: '1'.padStart(24, 'c') });
    await matcher.sweepOrphans();
    const hits = logged(/ORPHANED FILLED ORDER/);
    expect(hits).toHaveLength(1);
    expect(hits[0][0]).toContain('2'.padStart(24, 'c'));
    expect(users[A].balance).toBe(1000);
    expect(orders.map((o) => o.status)).toEqual(['filled', 'filled', 'filled']);
    Order.find.mockImplementation(() => { throw new Error('x'); });
    await expect(matcher.sweepOrphans()).resolves.toBeUndefined(); // non-fatal
});

test('cancel: if the release fails the order is put back open and the error surfaces', async () => {
    const { body } = await limit();
    User.findOneAndUpdate.mockImplementationOnce(async () => { throw new Error('db down'); });
    await expect(cancel(String(body.order._id))).rejects.toThrow('db down');
    expect(orders[0].status).toBe('open');
    expect(users[A].balance).toBeCloseTo(1000 - 90.09, 6);
    expect((await cancel(String(body.order._id))).statusCode).toBe(200);
    expect(users[A].balance).toBeCloseTo(1000, 6);
});

test('Order.create failure reverses the reservation (buy and sell)', async () => {
    Order.create.mockRejectedValueOnce(new Error('insert failed'));
    await expect(limit()).rejects.toThrow('insert failed');
    expect(users[A].balance).toBeCloseTo(1000, 6);
    Order.create.mockRejectedValueOnce(new Error('insert failed'));
    await expect(limit({ type: 'sell', amount: 1, limitPrice: 150 })).rejects.toThrow('insert failed');
    expect(users[A].holdings.BTC).toBe(2);
    expect(orders).toHaveLength(0);
});

describe('validation (POST /api/trades rules)', () => {
    // run the route's validator chain by hand (no socket): -> { status } 200 if it reaches the handler, else the validate() status
    const post = async (body) => {
        const req = { body };
        const out = { status: 200 };
        const res = { status: (c) => { out.status = c; return res; }, json: () => res };
        for (const mw of [...placeTradeRules(), validate]) {
            let nexted = false;
            await mw(req, res, () => { nexted = true; });
            if (!nexted) break;
        }
        return out;
    };
    test('unknown orderType -> 422', async () => { expect((await post({ orderType: 'stop' })).status).toBe(422); });
    test('object orderType -> 422', async () => { expect((await post({ orderType: { $ne: 1 } })).status).toBe(422); });
    test.each([[undefined], [0], [-5], ['90'], [null]])('limit with limitPrice %p -> 422', async (limitPrice) => {
        expect((await post({ orderType: 'limit', limitPrice })).status).toBe(422);
    });
    test('valid limit and default market pass', async () => {
        expect((await post({ orderType: 'limit', limitPrice: 90 })).status).toBe(200);
        expect((await post({ orderType: 'market' })).status).toBe(200);
        expect((await post({})).status).toBe(200);
    });
});
