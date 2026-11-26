// Integration: the bot engine on top of the REAL futuresOrders.openMarket and the REAL futuresLedger. Only Mongo models, candles and
// the mark are faked (in memory, each conditional update atomic as in futuresOrdersLedger.test.js). Covers the engine <-> order
// contract: positionId idempotency, noAdd, SL/TP and the notional cap from the fill price, and the ApiError codes the engine maps.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../services/tradeFill', () => ({ fillPrice: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ overview: jest.fn(), klines: jest.fn() }));
jest.mock('../models/User', () => ({ updateOne: jest.fn(), findById: jest.fn() }));
jest.mock('../models/Position', () => ({ create: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findOne: jest.fn(), findById: jest.fn(), countDocuments: jest.fn() }));
jest.mock('../models/FuturesOp', () => ({ create: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/Bot', () => ({ find: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), updateMany: jest.fn() }));
jest.mock('../models/BotDecision', () => ({ find: jest.fn(), findOne: jest.fn(), create: jest.fn(), updateOne: jest.fn() }));

const mongoose = require('mongoose');
const User = require('../models/User');
const Position = require('../models/Position');
const FuturesOp = require('../models/FuturesOp');
const Bot = require('../models/Bot');
const BotDecision = require('../models/BotDecision');
const futuresRest = require('../services/futuresRest');
const { fillPrice } = require('../services/tradeFill');
const orders = require('../services/futuresOrders');
const { botHash } = require('../services/strategy/hash');
const engine = require('../services/bot/botEngine');

const U = '64b7f0c2a1b2c3d4e5f60718';
const oid = () => String(new mongoose.Types.ObjectId());
const IDKEYS = ['_id', 'lockOp', 'userId', 'botId', 'positionId'];
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((x, k) => (x[k] = x[k] || {}), o)[last] = v; };
const unsetPath = (o, path) => { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => (x == null ? x : x[k]), o); if (t) delete t[last]; };
const matches = (doc, filter) => Object.entries(filter).every(([k, c]) => {
  if (k === '$or') return c.some((f) => matches(doc, f));
  let v = get(doc, k);
  const id = IDKEYS.includes(k);
  if (id && v != null) v = String(v);
  if (c && typeof c === 'object' && !(c instanceof Date) && !(id && c._bsontype)) {
    if ('$exists' in c) return (v !== undefined) === c.$exists;
    if ('$gte' in c) return v >= c.$gte;
    if ('$lt' in c) return v < c.$lt;
    if ('$ne' in c) return v != null && v !== String(c.$ne); // eslint-disable-line eqeqeq
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
const tick = (fn) => {
  const p = (async () => { await Promise.resolve(); return fn(); })();
  p.lean = () => p; p.select = () => p; p.sort = () => p; p.limit = () => p;
  return p;
};
const dup = () => Object.assign(new Error('E11000 dup'), { code: 11000 });
const coll = (M, rows, { uniqueBar } = {}) => {
  if (M.find) M.find.mockImplementation((f = {}) => tick(() => rows.filter((x) => matches(x, f)).map(clone)));
  M.findOne.mockImplementation((f) => tick(() => clone(rows.find((x) => matches(x, f)) || null)));
  if (M.findById) M.findById.mockImplementation((id) => tick(() => clone(rows.find((x) => String(x._id) === String(id)) || null)));
  if (M.findOneAndUpdate) M.findOneAndUpdate.mockImplementation((f, u) => tick(() => { const d = rows.find((x) => matches(x, f)); if (!d) return null; apply(d, u); return clone(d); }));
  M.updateOne.mockImplementation((f, u) => tick(() => { const d = rows.find((x) => matches(x, f)); if (d) apply(d, u); return { matchedCount: d ? 1 : 0, modifiedCount: d ? 1 : 0 }; }));
  if (M.updateMany) M.updateMany.mockImplementation((f, u) => tick(() => { rows.filter((x) => matches(x, f)).forEach((d) => apply(d, u)); }));
  if (uniqueBar) {
    M.create.mockImplementation((d) => tick(() => {
      if (typeof d.barTime === 'number' && rows.some((x) => x.botId === String(d.botId) && x.barTime === d.barTime)) throw dup();
      const r = { _id: oid(), status: 'done', ...d, botId: String(d.botId), userId: String(d.userId) }; rows.push(r); return clone(r);
    }));
  }
};

const HOUR = 3600;
const T0 = Date.UTC(2026, 10, 26, 12, 0, 10);
const BAR = Date.UTC(2026, 10, 26, 11, 0, 0) / 1000;
const SPEC = {
  version: 1, name: 'always', timeframe: '1h', direction: 'long',
  indicators: [{ id: 'fast', type: 'ema', source: 'close', period: 2 }],
  entry: { long: { all: [{ left: 'fast', op: 'gt', right: 0 }] } },
  exit: { long: { any: [{ left: 'fast', op: 'lt', right: 0 }] } },
  risk: { stopPct: 2, targetPct: 4 },
};
const candles = () => Array.from({ length: 40 }, (_, i) => ({ time: BAR - (39 - i) * HOUR, open: 100, high: 101, low: 99, close: 100, volume: 10 }));

let users; let positions; let ops; let bots; let decisions; let bot; let mark;
const open = (extra = {}) => orders.openMarket({ userId: U, symbol: 'BTC', side: 'long', size: 10, leverage: 1, ...extra });

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(T0);
  users = { [U]: { balance: 5000 } }; positions = []; ops = []; bots = []; decisions = []; mark = 100;
  fillPrice.mockImplementation(async () => (mark == null ? null : { price: mark, ageMs: 5 }));
  futuresRest.overview.mockResolvedValue([{ symbol: 'BTCUSDT' }]);
  futuresRest.klines.mockImplementation(async () => candles());
  coll(Position, positions); coll(FuturesOp, ops); coll(Bot, bots); coll(BotDecision, decisions, { uniqueBar: true });
  Position.create.mockImplementation((d) => tick(() => {
    if (positions.some((x) => String(x._id) === String(d._id) || (d.activeKey && x.activeKey === d.activeKey))) throw dup();
    positions.push({ ...d, _id: String(d._id), userId: String(d.userId) });
    return d;
  }));
  Position.countDocuments.mockImplementation((f) => tick(() => positions.filter((x) => matches(x, f)).length));
  FuturesOp.create.mockImplementation((d) => tick(() => { ops.push({ attempts: 0, createdAt: new Date(), ...d }); return d; }));
  FuturesOp.findOne.mockImplementation((f) => tick(() => clone([...ops].reverse().find((o) => String(o.userId) === String(f.userId) && o.targets.some((t) => String(t.id) === String(f['targets.id']))) || null)));
  User.updateOne.mockImplementation((f, upd) => tick(() => {
    const u = users[String(f._id)];
    if (!u || !matches(u, Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_id')))) return { matchedCount: 0 };
    apply(u, upd);
    return { matchedCount: 1 };
  }));
  User.findById.mockImplementation((id) => tick(() => clone(users[String(id)] || null)));
  bot = {
    _id: oid(), userId: U, name: 'b', spec: SPEC, specHash: 'x', symbol: 'BTC', interval: '1h', sizeUsd: 1000, leverage: 1,
    limits: { maxPositionUsd: 1000, maxLeverage: 1, dailyLossUsd: 50, maxTradesPerDay: 10, symbols: ['BTC'] },
    status: 'running', lastBarTime: 0, positionId: null, entryBarTime: null, day: { key: '', trades: 0, realizedCents: 0 }, errors: 0, stopReason: null,
  };
  bot.acceptedHash = botHash(bot);
  bots.push(bot);
});
afterEach(() => jest.restoreAllMocks());

test('the engine enters through the real openMarket: one position owned by the bot, SL/TP from the fill price, one debit', async () => {
  await engine.runOnce();
  expect(positions).toHaveLength(1);
  const p = positions[0];
  expect(p).toMatchObject({ status: 'open', side: 'long', size: 10, botId: bot._id, sl: 98, tp: 104 });
  expect(bot.positionId).toBe(p._id);
  const d = decisions.find((x) => x.kind === 'tick');
  expect(d).toMatchObject({ action: 'open_long', status: 'done' });
  expect(String(d.positionId)).toBe(p._id);
  expect(users[U].balance).toBeCloseTo(5000 - 1000 - 0.5 - 0, 1); // margin 1000 + fee 0.50 at 1x
  expect(ops).toHaveLength(1);
});

test('replaying the engine\'s positionId (same bot) returns the same fill and debits nothing; another bot or side is a conflict', async () => {
  await engine.runOnce();
  const p = positions[0];
  const balance = users[U].balance;
  const again = await open({ positionId: p._id, botId: bot._id, noAdd: true });
  expect(String(again.position._id)).toBe(p._id);
  expect(again.fill.price).toBe(100);
  expect(users[U].balance).toBe(balance);
  expect(positions).toHaveLength(1);
  await expect(open({ positionId: p._id, botId: oid(), noAdd: true })).rejects.toMatchObject({ status: 409, code: 'POSITION_CONFLICT' });
});

test('noAdd: an existing position on the market and side is a 409 POSITION_CONFLICT, never an add; without noAdd it adds', async () => {
  await open();
  await expect(open({ noAdd: true })).rejects.toMatchObject({ status: 409, code: 'POSITION_CONFLICT' });
  expect(positions).toHaveLength(1);
  expect(positions[0].size).toBe(10);
  await open();
  expect(positions[0].size).toBe(20);
});

test('stopPct/targetPct derive SL/TP from the ACTUAL fill price; a short mirrors them', async () => {
  mark = 101;
  const r = await open({ stopPct: 2, targetPct: 4, size: 9 });
  expect(r.position).toMatchObject({ sl: 98.98, tp: 105.04 });
  const s = await open({ side: 'short', stopPct: 2, targetPct: 4, size: 9 });
  expect(s.position).toMatchObject({ sl: 103.02, tp: 96.96 });
});

test('maxNotionalCents: a size that no longer fits at the fill price is 409 PRICE_MOVED and nothing moves', async () => {
  mark = 101; // sized at 100 (size 10 = 100000c), the fill is 101 (101000c)
  await expect(open({ maxNotionalCents: 100000 })).rejects.toMatchObject({ status: 409, code: 'PRICE_MOVED' });
  expect(positions).toHaveLength(0);
  expect(users[U].balance).toBe(5000);
});

test('ApiError codes the engine maps: NO_PRICE 503, INSUFFICIENT_BALANCE 400 end the intent as failed with no position', async () => {
  mark = null;
  await expect(open()).rejects.toMatchObject({ status: 503, code: 'NO_PRICE' });
  mark = 100;
  users[U].balance = 1;
  await engine.runOnce();
  expect(positions.filter((p) => p.status === 'open')).toHaveLength(0);
  expect(decisions.find((d) => d.kind === 'tick')).toMatchObject({ action: 'open_long', status: 'failed', reason: expect.objectContaining({ guard: 'INSUFFICIENT_BALANCE' }) });
  expect(bot.positionId).toBeNull();
  expect(users[U].balance).toBe(1);
});
