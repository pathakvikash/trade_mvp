// WP0 idempotency / concurrency: futuresOrders on top of the REAL futuresLedger. Only the Mongo models are faked, in memory,
// each conditional update atomic (check + apply in one synchronous step, as Mongo does for one document) with a microtask
// yield before it so concurrent calls really interleave. See also futuresOrders.test.js (mocked-ledger wiring tests).
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../services/tradeFill', () => ({ fillPrice: jest.fn() }));
jest.mock('../models/User', () => ({ updateOne: jest.fn(), findById: jest.fn() }));
jest.mock('../models/Position', () => ({ create: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findOne: jest.fn(), findById: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/FuturesOp', () => ({ create: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findOne: jest.fn() }));

const mongoose = require('mongoose');
const User = require('../models/User');
const Position = require('../models/Position');
const FuturesOp = require('../models/FuturesOp');
const { fillPrice } = require('../services/tradeFill');
const ledger = require('../services/futuresLedger');
const orders = require('../services/futuresOrders');

const U = '64b7f0c2a1b2c3d4e5f60718';
const oid = () => String(new mongoose.Types.ObjectId());
const IDKEYS = ['_id', 'lockOp', 'userId'];
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((x, k) => (x[k] = x[k] || {}), o)[last] = v; };
const unsetPath = (o, path) => { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => (x == null ? x : x[k]), o); if (t) delete t[last]; };
const matches = (doc, filter) => Object.entries(filter).every(([k, c]) => {
  let v = get(doc, k);
  const id = IDKEYS.includes(k);
  if (id && v != null) v = String(v);
  if (c && typeof c === 'object' && !(c instanceof Date) && !(id && c._bsontype)) {
    if ('$exists' in c) return (v !== undefined) === c.$exists;
    if ('$gte' in c) return v >= c.$gte;
    if ('$in' in c) return c.$in.includes(v);
    return false;
  }
  if (c == null) return v == null;
  return v === (id ? String(c) : c);
});
const apply = (doc, upd) => {
  for (const [k, d] of Object.entries(upd.$inc || {})) setPath(doc, k, (get(doc, k) || 0) + d);
  for (const [k, v] of Object.entries(upd.$set || {})) setPath(doc, k, v);
  for (const k of Object.keys(upd.$unset || {})) unsetPath(doc, k);
};
const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : d);
const tick = (fn) => { // atomic op behind a microtask yield; chainable like a mongoose query
  const p = (async () => { await Promise.resolve(); return fn(); })();
  p.lean = () => p; p.select = () => p; p.sort = () => p;
  return p;
};
const dup = () => Object.assign(new Error('E11000 dup'), { code: 11000 });

let users; let positions; let ops;
let missOpenLookup; // true: the next findOne({status:'open'}) (orders' findOpenPos) misses, simulating a lost race
let missIdLookup; // true: the next findOne by _id (orders' idempotency pre-check) misses

beforeEach(() => {
  jest.resetAllMocks();
  users = { [U]: { balance: 1000 } };
  positions = []; ops = []; missOpenLookup = false; missIdLookup = false;
  fillPrice.mockResolvedValue({ price: 100 });
  Position.create.mockImplementation((d) => tick(() => {
    if (positions.some((x) => String(x._id) === String(d._id) || (d.activeKey && x.activeKey === d.activeKey))) throw dup();
    positions.push({ ...d });
    return d;
  }));
  Position.findOneAndUpdate.mockImplementation((f, upd) => tick(() => { const d = positions.find((x) => matches(x, f)); if (!d) return null; apply(d, upd); return clone(d); }));
  Position.updateOne.mockImplementation((f, upd) => tick(() => { const d = positions.find((x) => matches(x, f)); if (d) apply(d, upd); return { matchedCount: d ? 1 : 0 }; }));
  Position.findOne.mockImplementation((f) => tick(() => {
    if (missOpenLookup && f.status === 'open') { missOpenLookup = false; return null; }
    if (missIdLookup && f._id && !f.status) { missIdLookup = false; return null; }
    return clone(positions.find((x) => matches(x, f)) || null);
  }));
  Position.findById.mockImplementation((id) => tick(() => clone(positions.find((x) => String(x._id) === String(id)) || null)));
  Position.countDocuments.mockImplementation((f) => tick(() => positions.filter((x) => matches(x, f)).length));
  FuturesOp.create.mockImplementation((d) => tick(() => { ops.push({ attempts: 0, createdAt: new Date(), ...d }); return d; }));
  FuturesOp.findById.mockImplementation((id) => tick(() => clone(ops.find((x) => String(x._id) === String(id)) || null)));
  FuturesOp.findOne.mockImplementation((f) => tick(() => clone([...ops].reverse().find((o) => String(o.userId) === String(f.userId) && o.targets.some((t) => String(t.id) === String(f['targets.id']))) || null)));
  FuturesOp.findOneAndUpdate.mockImplementation((f, upd) => tick(() => { const d = ops.find((x) => matches(x, f)); if (!d) return null; apply(d, upd); return clone(d); }));
  FuturesOp.updateOne.mockImplementation((f, upd) => tick(() => { const d = ops.find((x) => matches(x, f)); if (d) apply(d, upd); return { matchedCount: d ? 1 : 0 }; }));
  User.updateOne.mockImplementation((f, upd) => tick(() => {
    const u = users[String(f._id)];
    if (!u || !matches(u, Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_id')))) return { matchedCount: 0 };
    apply(u, upd);
    return { matchedCount: 1 };
  }));
  User.findById.mockImplementation((id) => tick(() => clone(users[String(id)] || null)));
});

// long 1 BTC @100, 10x: notional 10000c, fee 5c, margin 1000c, debit 1005c
const OPEN = 10.05;
const open = (extra = {}) => orders.openMarket({ userId: U, symbol: 'BTC', side: 'long', size: 1, leverage: 10, ...extra });
const seed = (over = {}) => { const d = { _id: oid(), userId: U, symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, mmr: 0.005, liqPrice: 90.36, realizedPnl: 0, fees: 0.05, status: 'open', lockOp: null, activeKey: `${U}:BTC:long`, ...over }; positions.push(d); return d; };
const balance = () => users[U].balance;
const noMarkers = () => expect(Object.keys(users[U].futuresOps || {})).toEqual([]);

test('same positionId twice: one position, one debit, the retry returns the same fill', async () => {
  const positionId = oid();
  const a = await open({ positionId });
  const b = await open({ positionId });
  expect(String(b.position._id)).toBe(String(a.position._id));
  expect(b.fill).toEqual({ price: 100, feeCents: 5 });
  expect(positions).toHaveLength(1);
  expect(ops).toHaveLength(1);
  expect(balance()).toBeCloseTo(1000 - OPEN, 6);
  noMarkers();
});

test('concurrent opens with the same positionId: one position, one debit, never an add; the loser is busy or idempotent', async () => {
  const positionId = oid();
  const r = await Promise.allSettled([open({ positionId }), open({ positionId }), open({ positionId })]);
  expect(r.some((x) => x.status === 'fulfilled')).toBe(true);
  for (const x of r) if (x.status === 'rejected') expect(x.reason).toMatchObject({ status: 409, code: 'POSITION_BUSY' });
  const again = await open({ positionId }); // a retry after the race is the plain idempotent answer
  expect(String(again.position._id)).toBe(positionId);
  expect(positions).toHaveLength(1);
  expect(positions[0]).toMatchObject({ size: 1, status: 'open' }); // an add would have made size 2
  expect(ops.every((o) => o.kind === 'open')).toBe(true);
  expect(balance()).toBeCloseTo(1000 - OPEN, 6);
});

test('lost activeKey race with the same positionId: onDuplicate answers idempotently instead of turning into an add', async () => {
  const positionId = oid();
  await open({ positionId });
  missIdLookup = true; missOpenLookup = true; // pre-check and findOpenPos miss (the twin committed in between); the insert hits E11000
  const b = await open({ positionId });
  expect(String(b.position._id)).toBe(positionId);
  expect(positions[0].size).toBe(1);
  expect(ops.filter((o) => o.kind === 'add')).toHaveLength(0);
  expect(balance()).toBeCloseTo(1000 - OPEN, 6); // a second debit here is the bug
});

test('a void, opening or closed document with the positionId is never returned as a fill', async () => {
  const id = oid();
  seed({ _id: id, status: 'void', activeKey: undefined });
  ops.push({ _id: new mongoose.Types.ObjectId(), userId: U, kind: 'open', targets: [{ model: 'Position', id }], status: 'rolled_back', lastError: 'INSUFFICIENT_BALANCE', createdAt: new Date() });
  await expect(open({ positionId: id })).rejects.toMatchObject({ status: 400, code: 'INSUFFICIENT_BALANCE' });

  const opening = oid();
  seed({ _id: opening, status: 'opening', lockOp: oid(), activeKey: `${U}:ETH:long` });
  await expect(open({ positionId: opening })).rejects.toMatchObject({ status: 409, code: 'POSITION_BUSY' });

  const closed = oid();
  seed({ _id: closed, status: 'closed', activeKey: undefined });
  await expect(open({ positionId: closed })).rejects.toMatchObject({ status: 409, code: 'NOT_OPEN' });

  const other = oid(); // open, but a different symbol/side/bot: the id is taken
  seed({ _id: other, symbol: 'ETH', activeKey: `${U}:ETH:long` });
  await expect(open({ positionId: other })).rejects.toMatchObject({ status: 409, code: 'POSITION_CONFLICT' });
  const botPos = oid();
  seed({ _id: botPos, side: 'short', botId: oid(), activeKey: `${U}:BTC:short` });
  await expect(open({ positionId: botPos, side: 'short' })).rejects.toMatchObject({ status: 409, code: 'POSITION_CONFLICT' }); // botId differs (none given)

  expect(balance()).toBe(1000);
  expect(ops.filter((o) => o.kind === 'open' && o.status === 'done')).toHaveLength(0);
});

test('noAdd inside onDuplicate: a position that wins the activeKey race is POSITION_CONFLICT, no add, no debit', async () => {
  const winner = seed();
  missOpenLookup = true; // findOpenPos misses it, so we try a fresh open and the insert hits E11000
  await expect(open({ noAdd: true, positionId: oid() })).rejects.toMatchObject({ status: 409, code: 'POSITION_CONFLICT' });
  expect(balance()).toBe(1000);
  expect(positions.filter((p) => p.status === 'open')).toHaveLength(1);
  expect(positions.find((p) => String(p._id) === String(winner._id)).size).toBe(1);
  expect(ops.filter((o) => o.kind === 'add')).toHaveLength(0);
  // without noAdd the same race becomes exactly one add
  missOpenLookup = true;
  await open();
  expect(positions.find((p) => String(p._id) === String(winner._id)).size).toBe(2);
});

test('two concurrent closeMarket on one position: exactly one credit', async () => {
  const p = seed();
  const id = String(p._id);
  const r = await Promise.allSettled([orders.closeMarket({ userId: U, positionId: id }), orders.closeMarket({ userId: U, positionId: id })]);
  const ok = r.filter((x) => x.status === 'fulfilled');
  expect(ok).toHaveLength(1);
  const lost = r.find((x) => x.status === 'rejected');
  expect(['POSITION_BUSY', 'NOT_OPEN']).toContain(lost.reason.code);
  expect(balance()).toBeCloseTo(1000 + ok[0].value.close.creditCents / 100, 6);
  expect(positions[0].status).toBe('closed');
  expect(ops.filter((o) => o.kind === 'close' && o.status === 'done')).toHaveLength(1);
  noMarkers();
});

test('crash right after the debit, then recovery: debited once, position open; a retry is idempotent', async () => {
  const positionId = oid();
  const real = User.updateOne.getMockImplementation();
  User.updateOne.mockImplementationOnce((f, u) => real(f, u).then(() => { throw new Error('crash after debit'); }));
  await expect(open({ positionId })).rejects.toThrow('crash after debit');
  expect(balance()).toBeCloseTo(1000 - OPEN, 6); // money moved, position still 'opening'
  expect(positions[0].status).toBe('opening');
  await expect(open({ positionId })).rejects.toMatchObject({ code: 'POSITION_BUSY' }); // not a fill yet
  await ledger.recover(ops[0]._id);
  expect(positions[0].status).toBe('open');
  expect(balance()).toBeCloseTo(1000 - OPEN, 6); // recovery did not debit again
  const again = await open({ positionId });
  expect(String(again.position._id)).toBe(positionId);
  expect(balance()).toBeCloseTo(1000 - OPEN, 6);
  expect(positions).toHaveLength(1);
  noMarkers();
});
