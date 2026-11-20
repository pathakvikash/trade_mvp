// /api/futures end to end through the real router + validators + controller (dispatched in-process, no sockets). Models are in-memory fakes and
// the ledger is a fake that mimics futuresLedger.run semantics (lock, E11000 on activeKey, conditional debit, frozen
// post state, onDuplicate) in ONE synchronous step, so races behave like MongoDB's per-document atomicity.
// Check vectors V1-V5 are from docs/phase2-leverage.md section 3.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../middleware/auth', () => (req, res, next) => {
  const id = req.headers['x-user'];
  if (!id) return res.status(401).json({ success: false, message: 'No token provided' });
  req.user = { userId: id };
  next();
});
jest.mock('../models/User', () => ({ findById: jest.fn() }));
jest.mock('../models/Position', () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/FuturesOrder', () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../services/futuresLedger', () => ({ run: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ isKnownSymbol: jest.fn() }));
jest.mock('../services/futuresService', () => ({ getMark: jest.fn() }));
jest.mock('../services/tradeFill', () => ({
  fillPrice: jest.fn(),
  userIdOf: (req) => (req.user && /^[a-f0-9]{24}$/.test(req.user.userId) ? String(req.user.userId) : null),
}));

const express = require('express');
const http = require('http');
const net = require('net');
const mongoose = require('mongoose');
const User = require('../models/User');
const Position = require('../models/Position');
const FuturesOrder = require('../models/FuturesOrder');
const ledger = require('../services/futuresLedger');
const futuresRest = require('../services/futuresRest');
const futuresService = require('../services/futuresService');
const { fillPrice } = require('../services/tradeFill');
const router = require('../routes/futuresRoutes');

const app = express();
app.use(express.json());
app.use('/api/futures', router);
app.use((err, req, res, next) => res.status(500).json({ success: false, message: 'Something went wrong' })); // eslint-disable-line no-unused-vars


// Minimal supertest stand-in: builds an IncomingMessage/ServerResponse pair and hands them to app.handle.
function dispatch(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = new http.IncomingMessage(new net.Socket());
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    req.method = method;
    req.url = path;
    req.headers = { ...headers, ...(payload && { 'content-type': 'application/json', 'content-length': String(payload.length) }) };
    if (payload) req.push(payload);
    req.push(null);
    const res = new http.ServerResponse(req);
    res.write = () => true;
    res.end = (chunk) => {
      let parsed;
      try { parsed = chunk ? JSON.parse(String(chunk)) : undefined; } catch (e) { parsed = String(chunk); }
      resolve({ statusCode: res.statusCode, body: parsed, headers: res.getHeaders() });
      return res;
    };
    app.handle(req, res, reject);
  });
}
const request = (m, path, user, body) => dispatch(m, `/api/futures${path}`, user ? { 'x-user': user } : {}, body);

const oid = () => String(new mongoose.Types.ObjectId());
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const IDS = ['_id', 'userId', 'lockOp'];
const matches = (doc, f) => Object.entries(f).every(([k, c]) => {
  let v = get(doc, k);
  const id = IDS.includes(k);
  if (id && v != null) v = String(v);
  if (c && typeof c === 'object' && '$in' in c) return c.$in.includes(v);
  if (c == null) return v == null;
  return v === (id ? String(c) : c);
});
const chain = (rows) => {
  let r = rows;
  const c = { sort: () => c, limit: (n) => { r = r.slice(0, n); return c; }, lean: () => c, then: (a, b) => Promise.resolve(r.map((x) => ({ ...x }))).then(a, b) };
  return c;
};
const one = (rows) => ({ lean: async () => (rows[0] ? { ...rows[0] } : null) });

let A;
let B;
let users;
let positions;
let orders;
let seq;
let mark;

function fakeRun(spec) {
  const coll = (m) => (m === 'Position' ? positions : orders);
  const opId = `op${++seq}`;
  const made = [];
  const unlock = () => {
    made.forEach(([c, d]) => { d.lockOp = null; });
  };
  for (const t of spec.targets) {
    const c = coll(t.model);
    if (t.create) {
      if (t.create.activeKey && c.some((d) => d.activeKey === t.create.activeKey && ['opening', 'open'].includes(d.status))) {
        unlock();
        return null; // marker for DUPLICATE_ACTIVE below
      }
      const d = { ...t.create, _id: String(t.id), lockOp: opId };
      c.push(d);
      made.push([c, d]);
    } else {
      const d = c.find((x) => matches(x, { _id: t.id, lockOp: null, ...(t.expect || {}) }));
      if (!d) { unlock(); return { op: { _id: opId, targets: spec.targets, status: 'rolled_back' }, ok: false, code: 'POSITION_BUSY' }; }
      d.lockOp = opId;
      made.push([c, d]);
    }
  }
  const u = users[spec.userId];
  const delta = spec.deltaCents / 100;
  if (spec.deltaCents < 0 && u.balance < -delta) {
    for (const [c, d] of made) if (['opening', 'placing'].includes(d.status)) c.splice(c.indexOf(d), 1);
    unlock();
    return { op: { _id: opId, targets: spec.targets, status: 'rolled_back' }, ok: false, code: 'INSUFFICIENT_BALANCE' };
  }
  u.balance = Math.round((u.balance + delta) * 100) / 100;
  for (const [, d] of made) {
    const { unset, ...set } = spec.post[d._id] || {};
    Object.assign(d, set);
    if (spec.targets.some((t) => t.model === 'Position' && String(t.id) === d._id)) d.rev = (d.rev || 0) + 1;
    for (const k of unset || []) delete d[k];
    d.lockOp = null;
  }
  return { op: { _id: opId, targets: spec.targets.map((t) => ({ model: t.model, id: String(t.id) })), status: 'done' }, ok: true };
}

beforeEach(() => {
  jest.resetAllMocks();
  A = oid();
  B = oid();
  users = { [A]: { balance: 1000 }, [B]: { balance: 1000 } };
  positions = [];
  orders = [];
  seq = 0;
  mark = 100;
  futuresRest.isKnownSymbol.mockResolvedValue(true);
  futuresService.getMark.mockImplementation(() => ({ markPrice: mark, ts: Date.now() }));
  fillPrice.mockImplementation(async () => ({ price: mark, ageMs: 0 }));
  User.findById.mockImplementation((id) => ({ select: () => ({ lean: async () => (users[String(id)] ? { ...users[String(id)] } : null) }) }));
  ledger.run.mockImplementation(async (spec) => {
    const r = fakeRun(spec);
    if (r) return r;
    if (spec.onDuplicate && !spec._retried) return ledger.run({ ...(await spec.onDuplicate()), _retried: true });
    return { op: { _id: 'dup', targets: spec.targets, status: 'rolled_back' }, ok: false, code: 'DUPLICATE_ACTIVE' };
  });
  for (const [M, rows] of [[Position, () => positions], [FuturesOrder, () => orders]]) {
    M.find.mockImplementation((f) => chain(rows().filter((d) => matches(d, f))));
    M.findOne.mockImplementation((f) => one(rows().filter((d) => matches(d, f))));
    M.findById.mockImplementation((id) => one(rows().filter((d) => d._id === String(id))));
    M.countDocuments.mockImplementation(async (f) => rows().filter((d) => matches(d, f)).length);
  }
  Position.findOneAndUpdate.mockImplementation((f, upd) => {
    const d = positions.find((x) => matches(x, f));
    if (d) { Object.assign(d, upd.$set); if (upd.$inc && upd.$inc.rev) d.rev = (d.rev || 0) + upd.$inc.rev; }
    return one(d ? [d] : []);
  });
});

const post = (path, body, user = A) => request('POST', path, user, body);
const patch = (path, body, user = A) => request('PATCH', path, user, body);
const del = (path, user = A) => request('DELETE', path, user);
const getp = (path, user = A) => request('GET', path, user);
const mkt = (over = {}, user = A) => post('/orders', { symbol: 'BTC', side: 'long', type: 'market', size: 1, leverage: 10, ...over }, user);
const lim = (over = {}, user = A) => post('/orders', { symbol: 'BTC', side: 'long', type: 'limit', size: 1, leverage: 10, limitPrice: 90, ...over }, user);
const seed = (over = {}) => {
  const p = {
    _id: oid(), userId: A, symbol: 'BTC', side: 'long', size: 2, entryPrice: 110, leverage: 10, margin: 22, mmr: 0.004, liqPrice: 99.39759036,
    tp: null, sl: null, status: 'open', activeKey: `${A}:BTC:long`, realizedPnl: 0, fees: 0.11, lockOp: null, openedAt: new Date(), updatedAt: new Date(), ...over,
  };
  positions.push(p);
  return p;
};

describe('auth and config', () => {
  test('401 without a token on every route', async () => {
    for (const [m, p] of [['get', '/config'], ['get', '/positions'], ['get', '/orders'], ['post', '/orders'], ['delete', `/orders/${oid()}`], ['post', `/positions/${oid()}/close`], ['patch', `/positions/${oid()}`]]) {
      expect((await request(m.toUpperCase(), p, null, {})).statusCode).toBe(401);
    }
  });

  test('GET /config serves the constants, Infinity as null', async () => {
    const res = await getp('/config');
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, takerFeeRate: 0.0005, minNotional: 5, maxPositions: 20, maxOrders: 20, symbolMaxLev: { BTC: 50, ETH: 50 }, defaultMaxLev: 20, fundingIgnored: true });
    expect(res.body.tiers[0]).toEqual({ maxNotional: 50000, maxLev: 50, mmr: 0.004 });
    expect(res.body.tiers[4]).toEqual({ maxNotional: null, maxLev: 2, mmr: 0.05 });
  });
});

describe('validation (422, nothing reaches the ledger)', () => {
  const bad = [
    ['missing symbol', { symbol: undefined }], ['lowercase symbol', { symbol: 'btc' }], ['dotted symbol', { symbol: 'BTC.X' }], ['object symbol', { symbol: { $gt: '' } }],
    ['bad side', { side: 'up' }], ['bad type', { type: 'stop' }],
    ['size 0', { size: 0 }], ['size negative', { size: -1 }], ['size string', { size: '1' }], ['size null', { size: null }], ['size too big', { size: 1e10 }], ['size rounds to 0', { size: 1e-9 }],
    ['leverage 0', { leverage: 0 }], ['leverage 51', { leverage: 51 }], ['leverage 2.5', { leverage: 2.5 }], ['leverage string', { leverage: '5' }], ['leverage missing', { leverage: undefined }],
    ['market with limitPrice', { limitPrice: 90 }],
    ['tp 0', { tp: 0 }], ['tp negative', { tp: -5 }], ['tp string', { tp: 'x' }], ['sl too big', { sl: 1e10 }],
    ['unknown key userId', { userId: 'x' }], ['unknown key balance', { balance: 1e9 }],
  ];
  test.each(bad)('market: %s', async (_n, over) => {
    const res = await mkt(over);
    expect(res.statusCode).toBe(422);
    expect(res.body.success).toBe(false);
    expect(ledger.run).not.toHaveBeenCalled();
  });

  test.each([['limit without limitPrice', { limitPrice: undefined }], ['limitPrice 0', { limitPrice: 0 }], ['limitPrice string', { limitPrice: '90' }], ['limitPrice NaN-ish null', { limitPrice: null }], ['limitPrice huge', { limitPrice: 1e10 }]])('limit: %s', async (_n, over) => {
    expect((await lim(over)).statusCode).toBe(422);
    expect(ledger.run).not.toHaveBeenCalled();
  });

  test('array body and close/patch shapes', async () => {
    expect((await post('/orders', [1])).statusCode).toBe(422);
    const id = oid();
    for (const body of [{ size: 0 }, { size: '1' }, { size: -1 }, { userId: A }]) expect((await post(`/positions/${id}/close`, body)).statusCode).toBe(422);
    for (const body of [{}, { foo: 1 }, { tp: 'x' }, { sl: 0 }, { tp: 100, userId: A }]) expect((await patch(`/positions/${id}`, body)).statusCode).toBe(422);
  });

  test('tp/sl null is accepted by the shape check', async () => {
    expect((await mkt({ tp: null, sl: null })).statusCode).toBe(201);
  });

  test('unknown market -> 400 UNKNOWN_MARKET; no price -> 503 NO_PRICE', async () => {
    futuresRest.isKnownSymbol.mockResolvedValue(false);
    let res = await mkt({ symbol: 'ZZZ' });
    expect([res.statusCode, res.body.code]).toEqual([400, 'UNKNOWN_MARKET']);
    futuresRest.isKnownSymbol.mockResolvedValue(true);
    fillPrice.mockResolvedValue(null);
    res = await mkt();
    expect([res.statusCode, res.body.code]).toEqual([503, 'NO_PRICE']);
    expect(users[A].balance).toBe(1000);
  });
});

describe('market open / add', () => {
  test('V1 long 1 @100 x10: debit 10.05, margin 10, liq 90.36144578, position open', async () => {
    const res = await mkt();
    expect(res.statusCode).toBe(201);
    expect(res.body.fill).toEqual({ price: 100, fee: 0.05 });
    expect(res.body.balance).toBe(989.95);
    expect(res.body.position).toMatchObject({ symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, liqPrice: 90.36144578, status: 'open', tp: null, sl: null, fees: 0.05 });
    expect(res.body.position.lockOp).toBeUndefined();
    expect(res.body.position.activeKey).toBeUndefined();
    expect(ledger.run).toHaveBeenCalledTimes(1);
    const spec = ledger.run.mock.calls[0][0];
    expect(spec).toMatchObject({ userId: A, kind: 'open', deltaCents: -1005 });
    expect(typeof spec.onDuplicate).toBe('function');
    expect(positions[0].userId).toBe(A);
  });

  test('V2 short 2 @100 x20: debit 10.10, liq 104.58167331', async () => {
    const res = await mkt({ side: 'short', size: 2, leverage: 20 });
    expect(res.statusCode).toBe(201);
    expect(res.body.balance).toBe(989.9);
    expect(res.body.position).toMatchObject({ side: 'short', margin: 10, liqPrice: 104.58167331 });
  });

  test('long and short on the same symbol coexist', async () => {
    expect((await mkt()).statusCode).toBe(201);
    expect((await mkt({ side: 'short' })).statusCode).toBe(201);
    expect(positions).toHaveLength(2);
  });

  test('V4 add 1 @120 x10 to V1: avg entry 110, margin 22, liq 99.39759036, debit 12.06', async () => {
    await mkt();
    mark = 120;
    const before = users[A].balance;
    const res = await mkt();
    expect(res.statusCode).toBe(201);
    expect(res.body.fill).toEqual({ price: 120, fee: 0.06 });
    expect(res.body.position).toMatchObject({ size: 2, entryPrice: 110, margin: 22, liqPrice: 99.39759036, fees: 0.11 });
    expect(users[A].balance).toBeCloseTo(before - 12.06, 6);
    expect(positions).toHaveLength(1);
    expect(ledger.run.mock.calls[1][0]).toMatchObject({ kind: 'add', deltaCents: -1206 });
  });

  test('add with a different leverage -> 409 LEVERAGE_MISMATCH, nothing charged', async () => {
    await mkt();
    const before = users[A].balance;
    const res = await mkt({ leverage: 5 });
    expect([res.statusCode, res.body.code]).toEqual([409, 'LEVERAGE_MISMATCH']);
    expect(users[A].balance).toBe(before);
  });

  test('add may overwrite tp/sl only with non-null values', async () => {
    await mkt({ tp: 150, sl: 95 });
    expect(positions[0]).toMatchObject({ tp: 150, sl: 95 });
    expect((await mkt()).statusCode).toBe(201);
    expect(positions[0]).toMatchObject({ tp: 150, sl: 95 });
    expect((await mkt({ tp: 160 })).statusCode).toBe(201);
    expect(positions[0]).toMatchObject({ tp: 160, sl: 95 });
  });

  test('tier cap: BTC 50x ok at $50k, 400 LEVERAGE_TOO_HIGH naming 20x above; alt capped at 20x', async () => {
    users[A].balance = 1e6;
    expect((await mkt({ size: 500, leverage: 50 })).statusCode).toBe(201); // $50,000 exactly
    let res = await mkt({ side: 'short', size: 501, leverage: 50 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'LEVERAGE_TOO_HIGH']);
    expect(res.body.message).toContain('20x');
    res = await mkt({ symbol: 'SOL', size: 1, leverage: 25 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'LEVERAGE_TOO_HIGH']);
    expect(res.body.message).toContain('20x');
  });

  test('tier cap applies to the combined notional of an add', async () => {
    users[A].balance = 1e6;
    expect((await mkt({ size: 400, leverage: 50 })).statusCode).toBe(201); // $40k
    const res = await mkt({ size: 200, leverage: 50 }); // $60k combined -> 20x max
    expect([res.statusCode, res.body.code]).toEqual([400, 'LEVERAGE_TOO_HIGH']);
    expect(positions[0].size).toBe(400);
  });

  test('min notional $5 -> 400 MIN_NOTIONAL (open and add)', async () => {
    let res = await mkt({ size: 0.04 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'MIN_NOTIONAL']);
    await mkt();
    res = await mkt({ size: 0.04 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'MIN_NOTIONAL']);
  });

  test('insufficient balance -> 400, no position left behind', async () => {
    const res = await mkt({ size: 100, leverage: 1 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'INSUFFICIENT_BALANCE']);
    expect(users[A].balance).toBe(1000);
    expect(positions).toHaveLength(0);
  });

  test('MAX_POSITIONS at 20 open; an add to an existing one is still allowed', async () => {
    for (let i = 0; i < 20; i++) seed({ symbol: `C${i}`, activeKey: `${A}:C${i}:long` });
    const res = await mkt({ symbol: 'SOL', leverage: 2 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'MAX_POSITIONS']);
    positions[0].lockOp = null;
    seed({ symbol: 'BTC', size: 1, entryPrice: 100, margin: 10, leverage: 10 });
    expect((await mkt()).statusCode).toBe(201); // 21 docs counted, but this is an add
  });

  test('busy position (lockOp set) -> 409 POSITION_BUSY', async () => {
    seed({ lockOp: 'someop', size: 1, entryPrice: 100, margin: 10 });
    const res = await mkt();
    expect([res.statusCode, res.body.code]).toEqual([409, 'POSITION_BUSY']);
  });

  test('two parallel opens on the same key: second becomes an add (E11000 path), both succeed', async () => {
    const [r1, r2] = await Promise.all([mkt(), mkt()]);
    expect([r1.statusCode, r2.statusCode]).toEqual([201, 201]);
    expect(positions.filter((p) => p.status === 'open')).toHaveLength(1);
    expect(positions[0].size).toBe(2);
    expect(users[A].balance).toBeCloseTo(1000 - 2 * 10.05, 6);
  });

  test('parallel opens with different leverage: the loser gets 409 LEVERAGE_MISMATCH', async () => {
    const rs = await Promise.all([mkt({ leverage: 10 }), mkt({ leverage: 5 })]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.statusCode === 409).body.code).toBe('LEVERAGE_MISMATCH');
    expect(positions).toHaveLength(1);
  });

  describe('tp/sl bounds at entry (ref = mark, liq from the quote)', () => {
    test.each([
      ['long tp at/below entry', { tp: 100 }],
      ['long sl at/above entry', { sl: 100 }],
      ['long sl at the liq price', { sl: 90.36144578 }],
      ['long sl below liq', { sl: 80 }],
      ['short tp at/above entry', { side: 'short', tp: 100 }],
      ['short sl at/below entry', { side: 'short', sl: 100 }],
      ['short sl beyond liq', { side: 'short', sl: 120 }],
    ])('%s -> 400 BAD_TPSL', async (_n, over) => {
      const res = await mkt(over);
      expect([res.statusCode, res.body.code]).toEqual([400, 'BAD_TPSL']);
      expect(ledger.run).not.toHaveBeenCalled();
    });

    test('valid long and short are stored', async () => {
      let res = await mkt({ tp: 120, sl: 95 });
      expect(res.body.position).toMatchObject({ tp: 120, sl: 95 });
      res = await mkt({ side: 'short', tp: 80, sl: 105 });
      expect(res.body.position).toMatchObject({ tp: 80, sl: 105 });
    });
  });
});

describe('limit orders', () => {
  test('place: reserves margin+fee at limitPrice (10.05 for 1 @90 x10 -> 9.0045 => 9.05), order open, no position', async () => {
    const res = await lim();
    expect(res.statusCode).toBe(201);
    // notional 9000c, margin 900c, fee ceil(4.5)=5c -> 905c
    expect(res.body.order).toMatchObject({ symbol: 'BTC', side: 'long', size: 1, leverage: 10, limitPrice: 90, reserved: 9.05, status: 'open', tp: null, sl: null });
    expect(res.body.balance).toBe(990.95);
    expect(ledger.run.mock.calls[0][0]).toMatchObject({ kind: 'place', deltaCents: -905 });
    expect(positions).toHaveLength(0);
  });

  test('tp/sl are checked against the limit price', async () => {
    let res = await lim({ tp: 85 });
    expect(res.body.code).toBe('BAD_TPSL');
    res = await lim({ tp: 95, sl: 88 });
    expect(res.statusCode).toBe(201);
    expect(res.body.order).toMatchObject({ tp: 95, sl: 88 });
  });

  test('limit rules: min notional, tier cap, insufficient funds, max orders, leverage mismatch vs an open position', async () => {
    expect((await lim({ size: 0.01 })).body.code).toBe('MIN_NOTIONAL');
    expect((await lim({ size: 600, limitPrice: 100, leverage: 50 })).body.code).toBe('LEVERAGE_TOO_HIGH');
    const poor = await lim({ size: 100, limitPrice: 100, leverage: 1 });
    expect([poor.statusCode, poor.body.code]).toEqual([400, 'INSUFFICIENT_BALANCE']);
    seed({ leverage: 5 });
    expect((await lim({ leverage: 10 })).body.code).toBe('LEVERAGE_MISMATCH');
    positions.length = 0;
    for (let i = 0; i < 20; i++) orders.push({ _id: oid(), userId: A, status: 'open' });
    const res = await lim();
    expect([res.statusCode, res.body.code]).toEqual([400, 'MAX_ORDERS']);
  });

  test('GET /orders: own open + last closed only', async () => {
    const mine = (await lim()).body.order._id;
    orders.push({ _id: oid(), userId: A, status: 'cancelled' }, { _id: oid(), userId: B, status: 'open' });
    const res = await getp('/orders');
    expect(res.body.orders.map((o) => o._id)).toEqual([mine]);
    expect(res.body.closed).toHaveLength(1);
    expect((await getp('/orders', B)).body.orders).toHaveLength(1);
  });

  test('cancel credits the reservation back; second cancel 409 NOT_OPEN', async () => {
    const id = (await lim()).body.order._id;
    const res = await del(`/orders/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.order.status).toBe('cancelled');
    expect(res.body.balance).toBe(1000);
    expect(ledger.run.mock.calls[1][0]).toMatchObject({ kind: 'cancel', deltaCents: 905 });
    const again = await del(`/orders/${id}`);
    expect([again.statusCode, again.body.code]).toEqual([409, 'NOT_OPEN']);
    expect(users[A].balance).toBe(1000);
  });

  test('cancel: IDOR 404, bad id 404, locked order 409 POSITION_BUSY', async () => {
    const id = (await lim()).body.order._id;
    const other = await del(`/orders/${id}`, B);
    expect([other.statusCode, other.body.code]).toEqual([404, 'NOT_FOUND']);
    expect(orders[0].status).toBe('open');
    expect((await del('/orders/not-an-id')).statusCode).toBe(404);
    expect((await del(`/orders/${oid()}`)).statusCode).toBe(404);
    orders[0].lockOp = 'op';
    expect((await del(`/orders/${id}`)).body.code).toBe('POSITION_BUSY');
  });

  test('cancel racing a fill: ledger POSITION_BUSY and the order is now filled -> 409 NOT_OPEN', async () => {
    const id = (await lim()).body.order._id;
    ledger.run.mockImplementationOnce(async () => {
      orders[0].status = 'filled';
      return { op: { _id: 'x' }, ok: false, code: 'POSITION_BUSY' };
    });
    expect((await del(`/orders/${id}`)).body.code).toBe('NOT_OPEN');
  });
});

describe('positions list', () => {
  test('own open (busy flag, markPrice snapshot, internals stripped) and own closed only', async () => {
    const p = seed({ lockOp: 'op1' });
    seed({ symbol: 'ETH', userId: B, activeKey: 'k' });
    seed({ status: 'closed', symbol: 'ETH', activeKey: undefined });
    seed({ status: 'liquidated', symbol: 'SOL', activeKey: undefined });
    seed({ status: 'opening', symbol: 'XRP' });
    const res = await getp('/positions');
    expect(res.statusCode).toBe(200);
    expect(res.body.positions).toHaveLength(1);
    expect(res.body.positions[0]).toMatchObject({ _id: p._id, busy: true, markPrice: 100 });
    expect(res.body.positions[0].lockOp).toBeUndefined();
    expect(res.body.positions[0].activeKey).toBeUndefined();
    expect(res.body.closed.map((c) => c.status).sort()).toEqual(['closed', 'liquidated']);
  });

  test('stale or missing mark -> markPrice null', async () => {
    seed();
    futuresService.getMark.mockReturnValue({ markPrice: 100, ts: Date.now() - 60000 });
    expect((await getp('/positions')).body.positions[0].markPrice).toBeNull();
    futuresService.getMark.mockReturnValue(undefined);
    expect((await getp('/positions')).body.positions[0].markPrice).toBeNull();
  });
});

describe('close', () => {
  test('V3 full close of V1 @110: credit 19.94, closed/manual, margin 0, activeKey cleared, reopen allowed', async () => {
    await mkt();
    mark = 110;
    const id = positions[0]._id;
    const res = await post(`/positions/${id}/close`, {});
    expect(res.statusCode).toBe(200);
    expect(res.body.close).toEqual({ size: 1, price: 110, pnl: 10, fee: 0.06, credit: 19.94 });
    expect(res.body.balance).toBe(1009.89); // +989c net vs start (V3)
    expect(res.body.position).toMatchObject({ status: 'closed', closeReason: 'manual', exitPrice: 110, margin: 0, realizedPnl: 10, fees: 0.11 });
    expect(positions[0].activeKey).toBeUndefined();
    expect(ledger.run.mock.calls[1][0]).toMatchObject({ kind: 'close', deltaCents: 1994 });
    expect((await mkt()).statusCode).toBe(201); // fresh position, no E11000
  });

  test('V5 partial close of V4 size 0.5 @110: credit 5.47, released 5.50, liq unchanged', async () => {
    const p = seed();
    mark = 110;
    const res = await post(`/positions/${p._id}/close`, { size: 0.5 });
    expect(res.statusCode).toBe(200);
    expect(res.body.close).toEqual({ size: 0.5, price: 110, pnl: 0, fee: 0.03, credit: 5.47 });
    expect(res.body.position).toMatchObject({ status: 'open', size: 1.5, margin: 16.5, liqPrice: 99.39759036, fees: 0.14, realizedPnl: 0 });
    expect(users[A].balance).toBe(1005.47);
    expect(positions[0].activeKey).toBeDefined();
  });

  test('short close in profit and loss', async () => {
    const p = seed({ side: 'short', size: 1, entryPrice: 100, margin: 10, leverage: 10, liqPrice: 109 });
    mark = 90;
    const res = await post(`/positions/${p._id}/close`, {});
    expect(res.body.close.pnl).toBe(10);
    expect(res.body.close.credit).toBe(19.95); // 10 + 10 - 0.05 fee (ceil 4.5c = 5c)
  });

  test('partial close leaving < $5 -> 400 MIN_NOTIONAL; size above position -> 400 BAD_SIZE', async () => {
    const p = seed({ size: 1, entryPrice: 100, margin: 10 });
    let res = await post(`/positions/${p._id}/close`, { size: 0.97 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'MIN_NOTIONAL']);
    expect(res.body.message).toMatch(/close all/);
    res = await post(`/positions/${p._id}/close`, { size: 1.5 });
    expect([res.statusCode, res.body.code]).toEqual([400, 'BAD_SIZE']);
    expect(ledger.run).not.toHaveBeenCalled();
  });

  test('IDOR / bad id -> 404; closed -> 409 NOT_OPEN; locked -> 409 POSITION_BUSY; no price -> 503', async () => {
    const p = seed();
    expect((await post(`/positions/${p._id}/close`, {}, B)).body.code).toBe('NOT_FOUND');
    expect((await post('/positions/zzz/close', {})).statusCode).toBe(404);
    expect((await post(`/positions/${oid()}/close`, {})).statusCode).toBe(404);
    p.lockOp = 'op';
    expect((await post(`/positions/${p._id}/close`, {})).body.code).toBe('POSITION_BUSY');
    p.lockOp = null;
    fillPrice.mockResolvedValue(null);
    expect((await post(`/positions/${p._id}/close`, {})).statusCode).toBe(503);
    fillPrice.mockImplementation(async () => ({ price: mark, ageMs: 0 }));
    p.status = 'liquidated';
    expect((await post(`/positions/${p._id}/close`, {})).body.code).toBe('NOT_OPEN');
    expect(users[A].balance).toBe(1000);
  });

  test('user close racing a TP/liquidation: loser sees NOT_OPEN, not a second settlement', async () => {
    const p = seed();
    ledger.run.mockImplementationOnce(async () => {
      p.status = 'closed';
      return { op: { _id: 'x' }, ok: false, code: 'POSITION_BUSY' };
    });
    expect((await post(`/positions/${p._id}/close`, {})).body.code).toBe('NOT_OPEN');
  });

  test('two parallel full closes settle once', async () => {
    const p = seed({ size: 1, entryPrice: 100, margin: 10 });
    const rs = await Promise.all([post(`/positions/${p._id}/close`, {}), post(`/positions/${p._id}/close`, {})]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(users[A].balance).toBeCloseTo(1000 + 10 - 0.05 + 0, 2);
  });
});

describe('stale snapshot (A-B-A)', () => {
  test('close built on a read taken before an add+partial-close round trip -> 409, no money moved', async () => {
    const p = seed({ size: 2, rev: 0 });
    futuresService.getMark.mockImplementation(() => { p.rev = 2; return { markPrice: mark, ts: Date.now() }; }); // size/status back where they were, rev moved
    fillPrice.mockImplementation(async () => { p.rev = 2; return { price: mark, ageMs: 0 }; });
    const res = await post(`/positions/${p._id}/close`, {});
    expect(res.statusCode).toBe(409);
    expect(['POSITION_BUSY', 'NOT_OPEN']).toContain(res.body.code);
    expect(users[A].balance).toBe(1000);
    expect(p).toMatchObject({ status: 'open', size: 2 });
  });

  test('TP/SL edit bumps rev (so any older snapshot is stale)', async () => {
    const p = seed({ size: 1, entryPrice: 100, margin: 10, liqPrice: 90.36144578, rev: 0 });
    expect((await patch(`/positions/${p._id}`, { tp: 120 })).statusCode).toBe(200);
    expect(p.rev).toBe(1);
  });
});

describe('edit tp/sl', () => {
  test('sets, changes and clears (null); only the given keys change', async () => {
    const p = seed({ size: 1, entryPrice: 100, margin: 10, liqPrice: 90.36144578 });
    let res = await patch(`/positions/${p._id}`, { tp: 120, sl: 95 });
    expect(res.statusCode).toBe(200);
    expect(res.body.position).toMatchObject({ tp: 120, sl: 95 });
    res = await patch(`/positions/${p._id}`, { tp: null });
    expect(res.body.position).toMatchObject({ tp: null, sl: 95 });
    expect(res.body.position.lockOp).toBeUndefined();
    expect(users[A].balance).toBe(1000); // no money moves
    expect(ledger.run).not.toHaveBeenCalled();
  });

  test.each([
    ['long tp at/below mark', { tp: 100 }],
    ['long sl at/above mark', { sl: 100 }],
    ['long sl at/below liq', { sl: 90.36144578 }],
  ])('%s -> 400 BAD_TPSL', async (_n, body) => {
    const p = seed({ size: 1, entryPrice: 100, margin: 10, liqPrice: 90.36144578 });
    const res = await patch(`/positions/${p._id}`, body);
    expect([res.statusCode, res.body.code]).toEqual([400, 'BAD_TPSL']);
    expect(p.tp).toBeNull();
  });

  test('short bounds use mark and liq on the other side', async () => {
    const p = seed({ side: 'short', size: 1, entryPrice: 100, margin: 10, liqPrice: 109 });
    expect((await patch(`/positions/${p._id}`, { tp: 105 })).body.code).toBe('BAD_TPSL');
    expect((await patch(`/positions/${p._id}`, { sl: 95 })).body.code).toBe('BAD_TPSL');
    expect((await patch(`/positions/${p._id}`, { sl: 110 })).body.code).toBe('BAD_TPSL');
    expect((await patch(`/positions/${p._id}`, { tp: 90, sl: 105 })).statusCode).toBe(200);
  });

  test('IDOR 404, closed 409 NOT_OPEN, locked 409 POSITION_BUSY, no price 503, lock race -> 409', async () => {
    const p = seed();
    expect((await patch(`/positions/${p._id}`, { tp: 150 }, B)).statusCode).toBe(404);
    expect(p.tp).toBeNull();
    p.lockOp = 'op';
    expect((await patch(`/positions/${p._id}`, { tp: 150 })).body.code).toBe('POSITION_BUSY');
    p.lockOp = null;
    fillPrice.mockResolvedValue(null);
    expect((await patch(`/positions/${p._id}`, { tp: 150 })).statusCode).toBe(503);
    fillPrice.mockImplementation(async () => ({ price: mark, ageMs: 0 }));
    Position.findOneAndUpdate.mockImplementationOnce(() => { p.lockOp = 'racer'; return one([]); }); // conditional update loses
    expect((await patch(`/positions/${p._id}`, { tp: 150 })).body.code).toBe('POSITION_BUSY');
    p.lockOp = null;
    p.status = 'closed';
    expect((await patch(`/positions/${p._id}`, { tp: 150 })).body.code).toBe('NOT_OPEN');
  });
});

describe('ledger result -> HTTP mapping', () => {
  test.each([
    ['INSUFFICIENT_BALANCE', 400, 'INSUFFICIENT_BALANCE'],
    ['POSITION_BUSY', 409, 'POSITION_BUSY'],
    ['DUPLICATE_ACTIVE', 409, 'POSITION_BUSY'],
    ['INCOMPLETE_LOCK', 409, 'POSITION_BUSY'],
  ])('%s', async (code, status, apiCode) => {
    ledger.run.mockResolvedValueOnce({ op: { _id: 'x' }, ok: false, code });
    const res = await mkt();
    expect([res.statusCode, res.body.code, res.body.success]).toEqual([status, apiCode, false]);
  });

  test('unknown failure -> 500 OP_FAILED; ledger throwing -> 500 generic', async () => {
    ledger.run.mockResolvedValueOnce({ op: { _id: 'x' }, ok: false, code: 'WEIRD' });
    expect((await mkt()).body.code).toBe('OP_FAILED');
    ledger.run.mockRejectedValueOnce(new Error('db down'));
    const res = await mkt();
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/db down/);
  });

  test('every money path uses the ledger only (User fake has no write methods)', async () => {
    await mkt();
    await lim();
    await del(`/orders/${orders[0]._id}`);
    await post(`/positions/${positions[0]._id}/close`, {});
    expect(ledger.run).toHaveBeenCalledTimes(4);
    expect(Object.keys(User)).toEqual(['findById']);
  });
});

describe('rate limits', () => {
  test('writes: 30/min per user (429 on the 31st), keyed per user, reads unlimited', async () => {
    const id = oid();
    for (let i = 0; i < 30; i++) expect((await del(`/orders/${id}`)).statusCode).toBe(404);
    const res = await del(`/orders/${id}`);
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect((await del(`/orders/${id}`, B)).statusCode).toBe(404); // other user unaffected
    for (let i = 0; i < 40; i++) expect((await getp('/positions')).statusCode).toBe(200);
  });

  test('every write route is limited before validation (rate-limited bad body still 429)', async () => {
    const u = oid();
    for (let i = 0; i < 30; i++) await post('/orders', {}, u);
    expect((await post('/orders', {}, u)).statusCode).toBe(429);
    expect((await post(`/positions/${oid()}/close`, {}, u)).statusCode).toBe(429);
    expect((await patch(`/positions/${oid()}`, { tp: 1 }, u)).statusCode).toBe(429);
  });
});
