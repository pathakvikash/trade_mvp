// WP3: bot engine against in-memory fakes (no DB, no network, no ledger). The fake futuresOrders is idempotent on positionId
// like the real one; crashes are injected by throwing at each step and then running recovery as a restart would.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { Types } = require('mongoose');

const mockGet = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const mockSet = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
const mockEq = (a, b) => (a == null || b == null ? a == b : String(a) === String(b)); // eslint-disable-line eqeqeq
const mockCond = (a, c) => {
  if (c && typeof c === 'object' && !(c instanceof Date) && !(c instanceof Types.ObjectId)) {
    if ('$ne' in c) return !mockEq(a, c.$ne);
    if ('$lt' in c) return a < c.$lt;
    if ('$gt' in c) return a > c.$gt;
    if ('$in' in c) return c.$in.some((x) => mockEq(x, a));
  }
  return mockEq(a, c);
};
const mockMatch = (r, f) => Object.entries(f).every(([k, v]) => (k === '$or' ? v.some((s) => mockMatch(r, s)) : mockCond(mockGet(r, k), v)));
const mockApply = (r, u) => {
  Object.entries(u.$set || {}).forEach(([k, v]) => mockSet(r, k, v));
  Object.entries(u.$inc || {}).forEach(([k, v]) => mockSet(r, k, (mockGet(r, k) || 0) + v));
};
const mockQ = (fn) => {
  let sort = null; let lim = Infinity;
  const o = {
    sort: (s) => { sort = s; return o; }, limit: (n) => { lim = n; return o; },
    lean: () => Promise.resolve().then(fn).then((v) => {
      if (!Array.isArray(v)) return v;
      let out = v;
      if (sort) { const [k, d] = Object.entries(sort)[0]; out = [...v].sort((a, b) => (a[k] > b[k] ? d : a[k] < b[k] ? -d : 0)); }
      return out.slice(0, lim).map((x) => ({ ...x }));
    }),
    then: (ok, ko) => o.lean().then(ok, ko),
  };
  return o;
};
const mockColl = (hooks = {}) => {
  const rows = [];
  return {
    __rows: rows,
    __hooks: hooks,
    find: (f = {}) => mockQ(() => rows.filter((r) => mockMatch(r, f))),
    findOne: (f) => mockQ(() => { const r = rows.find((x) => mockMatch(x, f)); return r ? { ...r } : null; }),
    findById: (id) => mockQ(() => { const r = rows.find((x) => mockEq(x._id, id)); return r ? { ...r } : null; }),
    findOneAndUpdate: (f, u) => mockQ(() => { const r = rows.find((x) => mockMatch(x, f)); if (r) mockApply(r, u); return r ? { ...r } : null; }),
    updateMany: async (f, u) => { rows.filter((x) => mockMatch(x, f)).forEach((r) => mockApply(r, u)); },
    updateOne: async (f, u) => {
      if (hooks.beforeUpdate) await hooks.beforeUpdate(f, u);
      const r = rows.find((x) => mockMatch(x, f)); if (r) mockApply(r, u); return { modifiedCount: r ? 1 : 0 };
    },
    create: async (d) => {
      if (typeof d.barTime === 'number' && rows.some((r) => String(r.botId) === String(d.botId) && r.barTime === d.barTime)) { const e = new Error('E11000 duplicate key'); e.code = 11000; throw e; }
      const r = { _id: new Types.ObjectId(), status: 'done', ...d }; rows.push(r); return { ...r };
    },
  };
};

jest.mock('../models/Bot', () => mockColl());
jest.mock('../models/BotDecision', () => mockColl());
jest.mock('../models/Position', () => mockColl());
jest.mock('../services/futuresRest', () => ({ overview: jest.fn(), klines: jest.fn() }));
jest.mock('../services/tradeFill', () => ({ fillPrice: jest.fn() }));
jest.mock('../services/futuresOrders', () => {
  class ApiError extends Error { constructor(status, code, m) { super(m); this.status = status; this.code = code; } }
  return { ApiError, openMarket: jest.fn(), closeMarket: jest.fn() };
});

const Bot = require('../models/Bot');
const BotDecision = require('../models/BotDecision');
const Position = require('../models/Position');
const futuresRest = require('../services/futuresRest');
const { fillPrice } = require('../services/tradeFill');
const orders = require('../services/futuresOrders');
const { botHash } = require('../services/strategy/hash');
const engine = require('../services/bot/botEngine');

const { tickBot, recoverIntents, INTENT_AGE_MS } = engine._test;
const HOUR = 3600;
const T0 = Date.UTC(2026, 10, 26, 12, 0, 10); // 10 s after the 12:00 UTC bar boundary
const BAR = Date.UTC(2026, 10, 26, 11, 0, 0) / 1000; // the 11:00 bar, just closed
const oid = () => new Types.ObjectId();
const userId = oid();

const SPEC = {
  version: 1, name: 'always', timeframe: '1h', direction: 'long',
  indicators: [{ id: 'fast', type: 'ema', source: 'close', period: 2 }],
  entry: { long: { all: [{ left: 'fast', op: 'gt', right: 0 }] } },
  exit: { long: { any: [{ left: 'fast', op: 'gt', right: 0 }] } },
  risk: { stopPct: 2, targetPct: 4 },
};
const candles = (last = BAR) => Array.from({ length: 40 }, (_, i) => ({ time: last - (39 - i) * HOUR, open: 100, high: 101, low: 99, close: 100, volume: 10 }));

let now;
let mark;
let balanceDebits;
let hooks;
let openCalls;

const mkBot = (over = {}) => {
  const b = {
    _id: oid(), userId, name: 'b', spec: SPEC, specHash: 'x', symbol: 'BTC', interval: '1h', sizeUsd: 1000, leverage: 1,
    limits: { maxPositionUsd: 1000, maxLeverage: 1, dailyLossUsd: 50, maxTradesPerDay: 10, symbols: ['BTC'] },
    status: 'running', lastBarTime: 0, positionId: null, entryBarTime: null, day: { key: '', trades: 0, realizedCents: 0 }, errors: 0, stopReason: null, ...over,
  };
  b.acceptedHash = over.acceptedHash === undefined ? botHash(b) : over.acceptedHash;
  Bot.__rows.push(b);
  return b;
};
const botRow = (b) => Bot.__rows.find((r) => String(r._id) === String(b._id));
const ticks = (b) => BotDecision.__rows.filter((d) => String(d.botId) === String(b._id) && d.kind === 'tick');
const openPositions = () => Position.__rows.filter((p) => p.status === 'open');
const pass = () => engine.runOnce();
const mkCtx = () => ({ busy: new Set(), marks: new Map(), candles: new Map(), allowed: null });
const ago = (ms) => new Date(now - ms);
const intentRow = (b, over) => { const d = { _id: oid(), botId: b._id, userId, kind: 'tick', status: 'intent', at: ago(1000), ...over }; BotDecision.__rows.push(d); return d; };
const nextBar = (k) => { now = T0 + k * HOUR * 1000; futuresRest.klines.mockImplementation(async () => candles(BAR + k * HOUR)); };
const mkPos = (b, over = {}) => {
  const p = { _id: oid(), userId, symbol: 'BTC', side: 'long', size: 10, entryPrice: 100, margin: 1000, status: 'open', realizedPnl: 0, fees: 0.5, lockOp: null, botId: b._id, ...over };
  Position.__rows.push(p);
  b.positionId = p._id;
  return p;
};

beforeEach(() => {
  Bot.__rows.length = 0; BotDecision.__rows.length = 0; Position.__rows.length = 0;
  now = T0; mark = 100; balanceDebits = 0; openCalls = 0;
  hooks = {};
  delete process.env.BOTS_ENABLED;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  futuresRest.overview.mockReset().mockResolvedValue([{ symbol: 'BTCUSDT' }]);
  futuresRest.klines.mockReset().mockImplementation(async () => candles());
  fillPrice.mockReset().mockImplementation(async () => (mark == null ? null : { price: mark, ageMs: 5 }));
  // idempotent on positionId, like the real openMarket; the debit counter stands for the ledger balance change
  orders.openMarket.mockReset().mockImplementation(async (a) => {
    openCalls += 1;
    if (hooks.beforeOrder) await hooks.beforeOrder();
    let p = Position.__rows.find((x) => String(x._id) === String(a.positionId));
    if (!p) {
      p = { _id: new Types.ObjectId(a.positionId), userId: a.userId, symbol: a.symbol, side: a.side, size: a.size, entryPrice: mark, status: 'open', realizedPnl: 0, fees: 0.5, margin: 1000, lockOp: null, botId: a.botId, sl: a.sl, tp: a.tp };
      Position.__rows.push(p);
      balanceDebits += 1;
    }
    if (hooks.afterOrder) await hooks.afterOrder();
    return { position: { ...p }, fill: { price: p.entryPrice, feeCents: 50 } };
  });
  orders.closeMarket.mockReset().mockImplementation(async (a) => {
    const p = Position.__rows.find((x) => String(x._id) === String(a.positionId));
    if (!p || p.status !== 'open') throw new orders.ApiError(409, 'NOT_OPEN', 'closed');
    p.status = 'closed'; p.exitPrice = mark; p.realizedPnl = (mark - p.entryPrice) * p.size; p.fees += 0.5; p.closeReason = a.reason;
    return { position: { ...p }, close: { size: p.size, price: mark, pnlCents: Math.floor(p.realizedPnl * 100), feeCents: 50, creditCents: 0 } };
  });
});
afterEach(() => jest.restoreAllMocks());

describe('entry and the per-bar claim', () => {
  test('a bar produces one order, bot position, TP/SL from the stop and target; the same bar again does nothing', async () => {
    const b = mkBot();
    await pass();
    expect(openCalls).toBe(1);
    expect(openPositions()).toHaveLength(1);
    const call = orders.openMarket.mock.calls[0][0];
    expect(call.noAdd).toBe(true);
    // SL/TP are derived by openMarket from the actual fill price (stopPct/targetPct), the size is capped by sizeUsd
    expect(call).toEqual(expect.objectContaining({ stopPct: 2, targetPct: 4, maxNotionalCents: 100000 }));
    expect(call.size).toBe(10);
    expect(botRow(b).positionId).toEqual(openPositions()[0]._id);
    expect(botRow(b).lastBarTime).toBe(BAR);
    expect(ticks(b)).toEqual([expect.objectContaining({ action: 'open_long', status: 'done', barTime: BAR, reason: expect.objectContaining({ signal: 'open_long' }) })]);
    expect(ticks(b)[0].reason.conds[0]).toEqual(expect.objectContaining({ text: 'fast > 0', ok: true }));
    await pass();
    expect(openCalls).toBe(1);
  });

  test('overlapping passes share one in-flight pass: one order', async () => {
    mkBot();
    await Promise.all([pass(), pass(), pass()]);
    expect(openCalls).toBe(1);
    expect(futuresRest.klines).toHaveBeenCalledTimes(1); // the claim alone would also give one order; the dedupe gives one pass
  });

  test('two ticks racing for the same bar (stale snapshots): the unique claim lets one order through', async () => {
    const b = mkBot();
    await Promise.all([tickBot({ ...botRow(b) }, mkCtx()), tickBot({ ...botRow(b) }, mkCtx())]);
    expect(openCalls).toBe(1);
    expect(openPositions()).toHaveLength(1);
    expect(balanceDebits).toBe(1);
  });

  test('missing bar is retried inside the window, then `missed` with no late entry', async () => {
    const b = mkBot();
    futuresRest.klines.mockImplementation(async () => candles(BAR - HOUR));
    await pass();
    expect(ticks(b)).toHaveLength(0);
    now = T0 + 45 * 1000;
    await pass();
    expect(ticks(b)).toHaveLength(0);
    now = T0 + 51 * 1000;
    await pass();
    expect(ticks(b)).toEqual([expect.objectContaining({ action: 'missed' })]);
    futuresRest.klines.mockImplementation(async () => candles());
    await pass();
    expect(openCalls).toBe(0);
  });

  test('candles from a foreign venue never produce a signal; the Binance spot mirror does', async () => {
    const b = mkBot();
    futuresRest.klines.mockImplementation(async () => Object.defineProperty(candles(), 'source', { value: 'bybit' }));
    await pass();
    expect(openCalls).toBe(0);
    expect(ticks(b)[0]).toEqual(expect.objectContaining({ action: 'skip', candlesSource: 'bybit', reason: expect.objectContaining({ guard: 'candles_source' }) }));
    const c = mkBot();
    futuresRest.klines.mockImplementation(async () => Object.defineProperty(candles(), 'source', { value: 'spot' }));
    await pass();
    expect(ticks(c)[0].action).toBe('open_long');
    expect(ticks(c)[0].candlesSource).toBe('spot');
  });

  test('a user position on the same side blocks the entry (POSITION_CONFLICT), never an add', async () => {
    const b = mkBot();
    Position.__rows.push({ _id: oid(), userId, symbol: 'BTC', side: 'long', status: 'open', size: 1, entryPrice: 100, margin: 10, botId: undefined });
    await pass();
    expect(openCalls).toBe(0);
    expect(ticks(b)[0]).toEqual(expect.objectContaining({ action: 'skip', reason: expect.objectContaining({ guard: 'POSITION_CONFLICT' }) }));
  });

  test('no mark: the entry is skipped with NO_PRICE, nothing ordered', async () => {
    const b = mkBot();
    mark = null;
    await pass();
    expect(openCalls).toBe(0);
    expect(ticks(b)[0].reason.guard).toBe('NO_PRICE');
  });
});

describe('crash injection: at most one position per bar, restart recovery', () => {
  const restart = async () => { now += INTENT_AGE_MS + 1000; await pass(); };

  test('crash after the claim (before the order): entry abandoned, never retried', async () => {
    const b = mkBot();
    hooks.beforeOrder = async () => { throw new Error('crash'); };
    await pass();
    expect(ticks(b)[0].status).toBe('intent');
    expect(openPositions()).toHaveLength(0);
    hooks.beforeOrder = null;
    await restart();
    expect(ticks(b)[0].status).toBe('abandoned');
    expect(openCalls).toBe(1);
    expect(openPositions()).toHaveLength(0);
    expect(botRow(b).positionId).toBeNull();
  });

  test('crash after the order: restart adopts the one position, no second order or debit', async () => {
    const b = mkBot();
    hooks.afterOrder = async () => { throw new Error('crash'); };
    await pass();
    expect(openPositions()).toHaveLength(1);
    expect(botRow(b).positionId).toBeNull();
    hooks.afterOrder = null;
    await pass(); // inside the 30 s gate: the bot is left alone
    expect(openCalls).toBe(1);
    await restart();
    expect(ticks(b)[0].status).toBe('done');
    expect(botRow(b).positionId).toEqual(openPositions()[0]._id);
    expect(openCalls).toBe(1);
    expect(balanceDebits).toBe(1);
  });

  test('crash before settling the decision: same, one position, one debit', async () => {
    const b = mkBot();
    let armed = true;
    BotDecision.__hooks.beforeUpdate = async (f) => { if (armed && f.status === 'intent') { armed = false; throw new Error('crash'); } };
    await pass();
    BotDecision.__hooks.beforeUpdate = null;
    expect(ticks(b)[0].status).toBe('intent');
    expect(openPositions()).toHaveLength(1);
    await restart();
    expect(ticks(b)[0].status).toBe('done');
    expect(botRow(b).positionId).toEqual(openPositions()[0]._id);
    expect(openCalls).toBe(1);
    expect(balanceDebits).toBe(1);
  });

  test('crash at the Bot position update (order done): the intent is still open, recovery adopts the position', async () => {
    const b = mkBot();
    let armed = true;
    Bot.__hooks.beforeUpdate = async (f, u) => { if (armed && u.$set && u.$set.positionId) { armed = false; throw new Error('crash'); } };
    await pass();
    Bot.__hooks.beforeUpdate = null;
    expect(openPositions()).toHaveLength(1);
    expect(botRow(b).positionId).toBeNull();
    expect(ticks(b)[0].status).toBe('intent'); // settled only AFTER the bot owns the position, else nothing would adopt it
    await restart();
    expect(ticks(b)[0].status).toBe('done');
    expect(botRow(b).positionId).toEqual(openPositions()[0]._id);
    expect(openCalls).toBe(1);
    expect(balanceDebits).toBe(1);
  });

  test('the same intent replayed with its position id gives the same single position (idempotent order)', async () => {
    const b = mkBot();
    await pass();
    const id = String(openPositions()[0]._id);
    await orders.openMarket({ userId: String(userId), symbol: 'BTC', side: 'long', size: 10, leverage: 1, positionId: id });
    expect(openPositions()).toHaveLength(1);
    expect(balanceDebits).toBe(1);
    expect(ticks(b)).toHaveLength(1);
  });

  test('a close intent with a still-open position is retried once (reduce-only); the close settles the day counter', async () => {
    const b = mkBot({ entryBarTime: BAR - 3 * HOUR, lastBarTime: BAR });
    const p = mkPos(b);
    mark = 95;
    BotDecision.__rows.push({ _id: oid(), botId: b._id, userId, kind: 'tick', barTime: BAR, action: 'close', status: 'intent', positionId: p._id, at: new Date(now - INTENT_AGE_MS - 1) });
    await pass();
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
    expect(orders.closeMarket.mock.calls[0][0].reason).toBe('bot');
    expect(Position.__rows[0].status).toBe('closed');
    expect(ticks(b)[0].status).toBe('done');
    expect(botRow(b).positionId).toBeNull();
    expect(botRow(b).day.realizedCents).toBe(-5000 - 100); // -50.00 price pnl, 1.00 fees
    await pass();
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
  });

  test('a close intent whose position is already closed is just done, booked once', async () => {
    const b = mkBot({ lastBarTime: BAR });
    const p = mkPos(b, { status: 'closed', realizedPnl: 10, fees: 1 });
    BotDecision.__rows.push({ _id: oid(), botId: b._id, userId, kind: 'tick', barTime: BAR, action: 'close', status: 'intent', positionId: p._id, at: new Date(now - INTENT_AGE_MS - 1) });
    await recoverIntents(now);
    await recoverIntents(now);
    expect(ticks(b)[0].status).toBe('done');
    expect(botRow(b).day.realizedCents).toBe(900);
    expect(orders.closeMarket).not.toHaveBeenCalled();
  });

  test('an exit on a new bar closes once; replaying the bar does not close again', async () => {
    const b = mkBot();
    await pass(); // enter on the 11:00 bar
    now += HOUR * 1000; // next bar closes
    const nextBar = BAR + HOUR;
    futuresRest.klines.mockImplementation(async () => candles(nextBar));
    await pass();
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
    expect(botRow(b).positionId).toBeNull();
    expect(ticks(b).find((d) => d.barTime === nextBar)).toEqual(expect.objectContaining({ action: 'close', status: 'done' }));
    await pass();
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
  });
});

describe('integrity, kill switch, stop, observed', () => {
  test('accept-hash mismatch halts the bot: paused, risk row, no order', async () => {
    const b = mkBot();
    botRow(b).spec = { ...SPEC, risk: { stopPct: 50 } }; // tampered after accept
    await pass();
    expect(botRow(b).status).toBe('paused');
    expect(botRow(b).stopReason).toBe('hash_mismatch');
    expect(BotDecision.__rows.find((d) => d.kind === 'risk').reason.code).toBe('hash_mismatch');
    expect(openCalls).toBe(0);
    expect(ticks(b)).toHaveLength(0);
  });

  test('a running bot that was never accepted does not trade', async () => {
    mkBot({ acceptedHash: null });
    await pass();
    expect(openCalls).toBe(0);
  });

  test('kill switch fires at exactly the daily limit: position closed, status killed; one cent short does nothing', async () => {
    const b = mkBot({ lastBarTime: BAR, entryBarTime: BAR });
    const p = mkPos(b);
    mark = 95.01; // unrealized -49.90 USD: inside the 50 USD limit
    await pass();
    expect(botRow(b).status).toBe('running');
    expect(p.status).toBe('open');
    mark = 95; // exactly -50.00 USD
    await pass();
    expect(botRow(b).status).toBe('killed');
    expect(botRow(b).stopReason).toBe('daily_loss');
    expect(p.status).toBe('closed');
    expect(p.closeReason).toBe('bot');
    expect(botRow(b).positionId).toBeNull();
    expect(BotDecision.__rows.find((d) => d.kind === 'risk' && d.reason.code === 'DAILY_LOSS')).toBeTruthy();
    expect(openCalls).toBe(0);
  });

  test('realized losses count toward the kill switch even when flat', async () => {
    const b = mkBot({ lastBarTime: BAR, day: { key: '2026-11-26', trades: 3, realizedCents: -5000 } });
    await pass();
    expect(botRow(b).status).toBe('killed');
  });

  test('no fresh mark: the kill check is skipped, nothing is closed', async () => {
    const b = mkBot({ lastBarTime: BAR, entryBarTime: BAR });
    const p = mkPos(b);
    mark = null;
    await pass();
    expect(botRow(b).status).toBe('running');
    expect(p.status).toBe('open');
    expect(orders.closeMarket).not.toHaveBeenCalled();
  });

  test('stop / stop-all: a stopped bot with a position gets it closed by the engine, once', async () => {
    const b = mkBot({ status: 'stopped', stopReason: 'stop_all' });
    const p = mkPos(b);
    await pass();
    expect(p.status).toBe('closed');
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
    expect(botRow(b).positionId).toBeNull();
    await pass();
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
  });

  test('a stopped bot whose close crashed after the order is settled by recovery, not closed twice', async () => {
    const b = mkBot({ status: 'stopped', stopReason: 'user' });
    const p = mkPos(b);
    BotDecision.__hooks.beforeUpdate = async (f) => { if (f.status === 'intent') throw new Error('crash'); };
    await pass();
    BotDecision.__hooks.beforeUpdate = null;
    expect(p.status).toBe('closed');
    now += INTENT_AGE_MS + 1000;
    await pass();
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
    expect(botRow(b).positionId).toBeNull();
    expect(BotDecision.__rows.filter((d) => d.status === 'intent')).toHaveLength(0);
  });

  test('a TP/SL/manual close is observed, booked once, and not re-entered on the same bar', async () => {
    const b = mkBot({ lastBarTime: BAR - HOUR, entryBarTime: BAR - HOUR });
    const p = mkPos(b, { status: 'closed', closeReason: 'sl', realizedPnl: -20, fees: 1, exitPrice: 98 });
    await pass();
    expect(BotDecision.__rows.filter((d) => d.kind === 'observed')).toHaveLength(1);
    expect(BotDecision.__rows[0].reason.closeReason).toBe('sl');
    expect(botRow(b).positionId).toBeNull();
    expect(botRow(b).day.realizedCents).toBe(-2100);
    expect(botRow(b).lastBarTime).toBe(BAR);
    expect(openCalls).toBe(0);
    await pass();
    expect(openCalls).toBe(0);
    expect(BotDecision.__rows.filter((d) => d.kind === 'observed')).toHaveLength(1);
    expect(p.status).toBe('closed');
  });

  test('repeated tick failures pause the bot after 10', async () => {
    const b = mkBot();
    orders.openMarket.mockRejectedValue(new Error('boom'));
    for (let i = 0; i < 10; i += 1) {
      botRow(b).lastBarTime = 0;
      BotDecision.__rows.length = 0;
      await pass();
    }
    expect(botRow(b).status).toBe('paused');
    expect(botRow(b).stopReason).toBe('errors');
  });
});

describe('review fixes: order gating, marks, paging, pause, disabled, stop', () => {
  test('status flipped after the pass snapshot (pause/stop/stop-all): the entry is skipped, no order', async () => {
    const b = mkBot();
    futuresRest.klines.mockImplementation(async () => { botRow(b).status = 'stopped'; return candles(); });
    await pass();
    expect(openCalls).toBe(0);
    expect(ticks(b)).toEqual([expect.objectContaining({ action: 'skip', status: 'done', reason: expect.objectContaining({ guard: 'CLAIM_REFUSED' }) })]);
  });

  test('the trade counter is claimed conditionally right before the order: a stale snapshot cannot overshoot the cap', async () => {
    const b = mkBot({ lastBarTime: 0 });
    const snap = { ...botRow(b), day: { key: '2026-11-26', trades: 9, realizedCents: 0 } };
    botRow(b).day = { key: '2026-11-26', trades: 10, realizedCents: 0 }; // another tick took the last slot
    await tickBot(snap, mkCtx());
    expect(openCalls).toBe(0);
    expect(botRow(b).day.trades).toBe(10);
    expect(ticks(b)[0].action).toBe('skip');
  });

  test('the mark is refetched after 1 s: a slow pass never feeds the kill switch a stale mark', async () => {
    const b1 = mkBot({ lastBarTime: BAR, entryBarTime: BAR });
    mkPos(b1);
    const b2 = mkBot({ lastBarTime: BAR, entryBarTime: BAR });
    const p2 = mkPos(b2);
    let calls = 0;
    fillPrice.mockImplementation(async () => { calls += 1; const m = mark; if (calls === 1) { now += 2000; mark = 95; } return { price: m, ageMs: 5 }; });
    await pass();
    expect(calls).toBe(2);
    expect(botRow(b1).status).toBe('running');
    expect(botRow(b2).status).toBe('killed'); // at the fresh 95 (-50.00); the stale 100 would have left it running
    expect(p2.status).toBe('closed');
  });

  test('no mark: realized loss alone at the limit still kills (unrealized counts 0), and closes the position', async () => {
    const b = mkBot({ lastBarTime: BAR, entryBarTime: BAR, day: { key: '2026-11-26', trades: 2, realizedCents: -5000 } });
    mkPos(b);
    mark = null;
    await pass();
    expect(botRow(b)).toMatchObject({ status: 'killed', stopReason: 'daily_loss' });
  });

  test('warm-up: a bot whose indicators need more candles than it has logs a WARMING_UP skip once per bar, never trades', async () => {
    const slow = { ...SPEC, indicators: [{ id: 'fast', type: 'ema', source: 'close', period: 20 }] }; // needs 60, has 40
    const b = mkBot({ spec: slow });
    await pass();
    await pass();
    expect(openCalls).toBe(0);
    expect(ticks(b)).toEqual([expect.objectContaining({ action: 'skip', status: 'done', reason: expect.objectContaining({ guard: 'WARMING_UP', need: 60, have: 40 }) })]);
  });

  test('paging: a pass reaches every eligible bot, not just the first 200', async () => {
    for (let i = 0; i < engine._test.PAGE; i += 1) mkBot({ lastBarTime: BAR });
    const last = mkBot();
    await pass();
    expect(openCalls).toBe(1);
    expect(botRow(last).positionId).not.toBeNull();
  });

  test('paused bot: its open position stays open under SL/TP (no engine close, even at a huge loss)', async () => {
    const b = mkBot({ status: 'paused', entryBarTime: BAR });
    const p = mkPos(b);
    mark = 1;
    await pass();
    expect(p.status).toBe('open');
    expect(orders.closeMarket).not.toHaveBeenCalled();
    expect(botRow(b)).toMatchObject({ status: 'paused', positionId: p._id });
  });

  test('paused bot: a TP/SL close is booked the day it happens; an opening position is left alone', async () => {
    const b = mkBot({ status: 'paused', entryBarTime: BAR - HOUR });
    mkPos(b, { status: 'closed', closeReason: 'sl', realizedPnl: -20, fees: 1, exitPrice: 98 });
    const c = mkBot({ status: 'paused' });
    const op = mkPos(c, { status: 'opening' });
    await pass();
    expect(botRow(b).positionId).toBeNull();
    expect(botRow(b).day.realizedCents).toBe(-2100);
    expect(BotDecision.__rows.filter((d) => d.kind === 'observed')).toHaveLength(1);
    expect(botRow(c).positionId).toEqual(op._id);
  });

  test('BOTS_ENABLED=false: running bots are paused (bots_disabled), stopped bots with a position are still closed, nothing enters', async () => {
    process.env.BOTS_ENABLED = 'false';
    const run = mkBot();
    const stopped = mkBot({ status: 'stopped', stopReason: 'user' });
    const p = mkPos(stopped);
    await pass();
    expect(botRow(run)).toMatchObject({ status: 'paused', stopReason: 'bots_disabled' });
    expect(p.status).toBe('closed');
    expect(botRow(stopped).positionId).toBeNull();
    expect(openCalls).toBe(0);
    expect(futuresRest.klines).not.toHaveBeenCalled();
  });

  test('stop() mid-pass: no further bot is ticked (not even a close) and no order is placed', async () => {
    const b1 = mkBot();
    const b2 = mkBot({ status: 'stopped', stopReason: 'user' });
    const p2 = mkPos(b2);
    futuresRest.klines.mockImplementation(async () => { engine.stop(); return candles(); });
    try {
      await pass();
      expect(openCalls).toBe(0);
      expect(ticks(b1)).toHaveLength(0);
      expect(p2.status).toBe('open');
      expect(orders.closeMarket).not.toHaveBeenCalled();
    } finally { engine._test.resume(); }
  });

  test('release rolls an older day forward, never rewinds a newer key', async () => {
    const a = mkBot({ lastBarTime: BAR - HOUR, day: { key: '2026-11-25', trades: 5, realizedCents: -300 } });
    mkPos(a, { status: 'closed', realizedPnl: 10, fees: 1 });
    const f = mkBot({ lastBarTime: BAR - HOUR, day: { key: '2026-11-27', trades: 5, realizedCents: -300 } });
    mkPos(f, { status: 'closed', realizedPnl: 10, fees: 1 });
    await pass();
    expect(botRow(a).day).toEqual({ key: '2026-11-26', trades: 0, realizedCents: 900 });
    expect(botRow(f).day).toEqual({ key: '2026-11-27', trades: 5, realizedCents: 600 });
  });
});

describe('review fixes: mutation guards', () => {
  const SPEC_BARS = { ...SPEC, exit: { long: { any: [{ left: 'fast', op: 'lt', right: 0 }] } }, risk: { stopPct: 2, maxBars: 3 } };

  test('maxBars: the position is closed on the bar it has been held that long, not before', async () => {
    const b = mkBot({ spec: SPEC_BARS, entryBarTime: BAR - 2 * HOUR, lastBarTime: BAR - HOUR });
    mkPos(b);
    await pass();
    expect(orders.closeMarket).not.toHaveBeenCalled();
    expect(ticks(b)[0]).toEqual(expect.objectContaining({ action: 'hold' }));
    const c = mkBot({ spec: SPEC_BARS, entryBarTime: BAR - 3 * HOUR, lastBarTime: BAR - HOUR });
    mkPos(c);
    await pass();
    expect(orders.closeMarket).toHaveBeenCalledTimes(1);
    expect(ticks(c)[0]).toEqual(expect.objectContaining({ action: 'close', reason: expect.objectContaining({ signal: 'max_bars' }) }));
  });

  test('INSUFFICIENT_BALANCE on 3 consecutive entries pauses the bot (2 do not)', async () => {
    const b = mkBot();
    orders.openMarket.mockRejectedValue(new orders.ApiError(400, 'INSUFFICIENT_BALANCE', 'no money'));
    await pass();
    nextBar(1);
    await pass();
    expect(botRow(b).status).toBe('running');
    expect(ticks(b).map((d) => d.status)).toEqual(['failed', 'failed']);
    nextBar(2);
    await pass();
    expect(botRow(b)).toMatchObject({ status: 'paused', stopReason: 'balance' });
  });

  test('a bot with an unresolved young intent is left alone (busy), running or stopped', async () => {
    const b = mkBot();
    intentRow(b, { barTime: BAR - HOUR, action: 'open_long', positionId: oid() });
    const s = mkBot({ status: 'stopped', stopReason: 'user' });
    const p = mkPos(s);
    intentRow(s, { action: 'close', positionId: p._id });
    await pass();
    expect(openCalls).toBe(0);
    expect(orders.closeMarket).not.toHaveBeenCalled();
    expect(p.status).toBe('open');
    expect(ticks(b).filter((d) => d.barTime === BAR)).toHaveLength(0);
  });

  test('lockOp: recovery and the stop-close never act on a locked or opening position', async () => {
    const lock = oid();
    const a = mkBot({ lastBarTime: BAR });
    const pa = mkPos(a, { lockOp: lock });
    const da = intentRow(a, { barTime: BAR, action: 'close', positionId: pa._id, at: ago(INTENT_AGE_MS + 1) });
    const e = mkBot({ lastBarTime: BAR });
    const pe = { _id: oid(), userId, symbol: 'BTC', side: 'long', status: 'open', lockOp: lock, botId: e._id };
    Position.__rows.push(pe);
    const de = intentRow(e, { barTime: BAR, action: 'open_long', positionId: pe._id, at: ago(INTENT_AGE_MS + 1) });
    const o = mkBot({ lastBarTime: BAR });
    const po = { _id: oid(), userId, symbol: 'BTC', side: 'long', status: 'opening', lockOp: null, botId: o._id };
    Position.__rows.push(po);
    const dop = intentRow(o, { barTime: BAR, action: 'open_long', positionId: po._id, at: ago(INTENT_AGE_MS + 1) });
    await recoverIntents(now);
    expect(orders.closeMarket).not.toHaveBeenCalled();
    expect([da.status, de.status, dop.status].map((_, i) => BotDecision.__rows.find((r) => String(r._id) === String([da, de, dop][i]._id)).status)).toEqual(['intent', 'intent', 'intent']);
    expect(botRow(e).positionId).toBeNull();
    expect(botRow(o).positionId).toBeNull();
    const s = mkBot({ status: 'stopped', stopReason: 'user' });
    mkPos(s, { lockOp: lock });
    await engine._test.closeBotPosition(botRow(s), 'user');
    expect(orders.closeMarket).not.toHaveBeenCalled();
    expect(BotDecision.__rows.filter((r) => String(r.botId) === String(s._id))).toHaveLength(0);
  });

  test('kill switch is conditional on status running: a bot paused/stopped since the snapshot is not flipped to killed', async () => {
    const b = mkBot({ lastBarTime: BAR, day: { key: '2026-11-26', trades: 3, realizedCents: -5000 } });
    const snap = { ...botRow(b) };
    botRow(b).status = 'stopped';
    botRow(b).stopReason = 'user';
    await tickBot(snap, mkCtx());
    expect(botRow(b)).toMatchObject({ status: 'stopped', stopReason: 'user' });
    expect(BotDecision.__rows.find((d) => d.kind === 'risk')).toBeUndefined();
  });

  test('a successful tick resets the consecutive-error counter', async () => {
    const b = mkBot({ lastBarTime: BAR, errors: 3 });
    await pass();
    expect(botRow(b).errors).toBe(0);
  });

  test('openMarket failures: 4xx and NO_PRICE end the intent as failed, server errors and crashes leave it for recovery (and count as errors)', async () => {
    const cases = [
      [new orders.ApiError(409, 'PRICE_MOVED', 'x'), 'failed', 0],
      [new orders.ApiError(503, 'NO_PRICE', 'x'), 'failed', 0],
      [new orders.ApiError(500, 'OP_FAILED', 'x'), 'intent', 1],
      [new Error('boom'), 'intent', 1],
    ];
    for (const [err, status, errors] of cases) {
      Bot.__rows.length = 0; BotDecision.__rows.length = 0;
      const b = mkBot();
      orders.openMarket.mockReset().mockRejectedValue(err);
      await pass();
      expect([err.code || err.message, ticks(b)[0].status, botRow(b).errors]).toEqual([err.code || err.message, status, errors]);
      if (status === 'failed') expect(ticks(b)[0].reason.guard).toBe(err.code);
    }
  });

  test('a position that is `opening` is not treated as closed: nothing is released or booked', async () => {
    const b = mkBot({ lastBarTime: BAR - HOUR });
    const p = mkPos(b, { status: 'opening' });
    await pass();
    expect(botRow(b).positionId).toEqual(p._id);
    expect(BotDecision.__rows.filter((d) => d.kind === 'observed')).toHaveLength(0);
    expect(openCalls).toBe(0);
  });

  test('a signal for a different bar than the one being decided is ignored (last closed candle unusable)', async () => {
    const b = mkBot();
    futuresRest.klines.mockImplementation(async () => candles().map((c, i, a) => (i === a.length - 1 ? { ...c, open: null } : c)));
    await pass();
    expect(openCalls).toBe(0);
    expect(ticks(b)).toHaveLength(0);
  });
});

describe('boundaries', () => {
  test('engine, guard and order modules require no AI or news code', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['services/bot/botEngine.js', 'services/bot/riskGuard.js', 'services/futuresOrders.js']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      const reqs = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
      expect(reqs.filter((r) => /services\/ai\/|\/ai\/|aiService|aiProviders|news/i.test(r))).toEqual([]);
    }
  });

  test('the engine never imports the ledger or the User model', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services/bot/botEngine.js'), 'utf8');
    expect(src).not.toMatch(/require\([^)]*(futuresLedger|models\/User)/);
  });

  test('BOTS_ENABLED=false still starts the close-only loop; production defaults off, development on', () => {
    jest.useFakeTimers();
    process.env.BOTS_ENABLED = 'false';
    engine.start();
    expect(jest.getTimerCount()).toBe(1);
    engine.stop();
    engine._test.resume();
    expect(jest.getTimerCount()).toBe(0);
    expect(engine._test.enabled()).toBe(false);
    delete process.env.BOTS_ENABLED;
    expect(engine._test.enabled()).toBe(true); // NODE_ENV=test
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    expect(engine._test.enabled()).toBe(false);
    process.env.BOTS_ENABLED = 'true';
    expect(engine._test.enabled()).toBe(true);
    process.env.NODE_ENV = env;
    delete process.env.BOTS_ENABLED;
    jest.useRealTimers();
  });
});
