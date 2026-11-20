// Leveraged paper futures API (spec docs/phase2-leverage.md section 5). Every balance/position change goes through
// futuresLedger.run(opSpec); this file only validates, quotes (futuresMath) and maps the ledger result to HTTP.
// The user comes from the JWT only. Other users' ids look like missing ones (404).
const mongoose = require('mongoose');
const Position = require('../models/Position');
const FuturesOrder = require('../models/FuturesOrder');
const User = require('../models/User');
const logger = require('../config/logger');
const BaseController = require('./BaseController');
const ledger = require('../services/futuresLedger');
const fm = require('../services/futuresMath');
const futuresRest = require('../services/futuresRest');
const futuresService = require('../services/futuresService');
const { fillPrice, userIdOf } = require('../services/tradeFill');
const { MIN_NOTIONAL_CENTS, round8, notionalCents } = require('../services/tradeMath');

const MAX_POSITIONS = 20;
const MAX_ORDERS = 20;
const MARK_MAX_AGE_MS = 3000;
const OID = /^[a-f0-9]{24}$/i;

const r2 = (x) => Math.round(x * 100) / 100;
const usd = (cents) => cents / 100;
const cents = (dollars) => Math.round(dollars * 100);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message); };

// BaseController.wrap + ApiError -> { success:false, code, message }
const handle = (fn) => BaseController.wrap(async (req, res) => {
  const userId = userIdOf(req);
  try {
    if (!userId) fail(401, 'UNAUTHORIZED', 'Invalid token');
    await fn(req, res, userId);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    res.status(e.status).json({ success: false, code: e.code, message: e.message });
  }
});

const idParam = (req) => {
  const id = req.params.id;
  if (typeof id !== 'string' || !OID.test(id) || !mongoose.isValidObjectId(id)) fail(404, 'NOT_FOUND', 'Not found');
  return id;
};

const balanceOf = async (userId) => {
  const u = await User.findById(userId).select('balance').lean();
  return u ? r2(u.balance) : null;
};

const markNow = async (symbol) => {
  const f = await fillPrice(`${symbol}USDT`);
  if (!f) fail(503, 'NO_PRICE', 'No price available for this market right now, try again shortly');
  return f;
};

// Long: liq < sl < ref < tp. Short: tp < ref < sl < liq. null / undefined = not set. -> message | null
function tpslError(side, ref, liq, tp, sl) {
  const long = side === 'long';
  if (tp != null && (long ? tp <= ref : tp >= ref)) return `Take profit must be ${long ? 'above' : 'below'} ${ref}`;
  if (sl != null) {
    if (long ? sl >= ref : sl <= ref) return `Stop loss must be ${long ? 'below' : 'above'} ${ref}`;
    if (long ? sl <= liq : sl >= liq) return `Stop loss must be ${long ? 'above' : 'below'} the liquidation price ${liq}`;
  }
  return null;
}
const checkTpsl = (side, ref, liq, tp, sl) => {
  const m = tpslError(side, ref, liq, tp, sl);
  if (m) fail(400, 'BAD_TPSL', m);
};

// Leverage vs the symbol/tier cap for the notional (USD) after the op.
function checkLeverage(symbol, notionalUsd, leverage) {
  const max = fm.maxLeverage(symbol, notionalUsd);
  if (leverage > max) fail(400, 'LEVERAGE_TOO_HIGH', `Maximum leverage for this position size is ${max}x`);
}

// Ledger failure -> HTTP. DUPLICATE_ACTIVE / INCOMPLETE_LOCK are lost races: retryable like a busy lock.
function ledgerFail(r) {
  if (r.code === 'INSUFFICIENT_BALANCE') fail(400, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
  if (r.code === 'POSITION_BUSY' || r.code === 'DUPLICATE_ACTIVE' || r.code === 'INCOMPLETE_LOCK') fail(409, 'POSITION_BUSY', 'Position is being updated, retry in a moment');
  logger.error(`futures: op ${r.op && r.op._id} failed with ${r.code}`);
  fail(500, 'OP_FAILED', 'Operation failed');
}

const publicPos = (p, extra) => {
  const { lockOp, activeKey, ...rest } = p;
  return { ...rest, ...extra };
};
const freshMark = (symbol) => {
  const m = futuresService.getMark(`${symbol}USDT`);
  return m && m.markPrice > 0 && Date.now() - m.ts <= MARK_MAX_AGE_MS ? m.markPrice : null;
};

// ---- reads ----
exports.config = BaseController.wrap(async (req, res) => {
  res.json({
    success: true,
    takerFeeRate: fm.TAKER_FEE_BPS / 10000,
    minNotional: MIN_NOTIONAL_CENTS / 100,
    maxPositions: MAX_POSITIONS,
    maxOrders: MAX_ORDERS,
    symbolMaxLev: fm.SYMBOL_MAX_LEV,
    defaultMaxLev: fm.DEFAULT_MAX_LEV,
    tiers: fm.TIERS.map((t) => ({ maxNotional: Number.isFinite(t.maxNotional) ? t.maxNotional : null, maxLev: t.maxLev, mmr: t.mmr })),
    fundingIgnored: true,
  });
});

exports.listPositions = handle(async (req, res, userId) => {
  const [open, closed] = await Promise.all([
    Position.find({ userId, status: 'open' }).sort({ openedAt: -1 }).lean(),
    Position.find({ userId, status: { $in: ['closed', 'liquidated'] } }).sort({ updatedAt: -1 }).limit(20).lean(),
  ]);
  res.json({
    success: true,
    positions: open.map((p) => publicPos(p, { busy: p.lockOp != null, markPrice: freshMark(p.symbol) })),
    closed: closed.map((p) => publicPos(p)),
  });
});

exports.listOrders = handle(async (req, res, userId) => {
  const [orders, closed] = await Promise.all([
    FuturesOrder.find({ userId, status: 'open' }).sort({ createdAt: -1 }).lean(),
    FuturesOrder.find({ userId, status: { $in: ['filled', 'cancelled', 'rejected'] } }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  res.json({ success: true, orders, closed });
});

// ---- open / add / place ----
// Re-reads the open position after a lost activeKey race and builds the 'add' spec (called by the ledger).
function addSpec({ userId, pos, size, price, leverage, tp, sl }) {
  if (pos.leverage !== leverage) fail(409, 'LEVERAGE_MISMATCH', `You already hold this position at ${pos.leverage}x; add with the same leverage`);
  const addNotional = notionalCents(size, price);
  if (addNotional < MIN_NOTIONAL_CENTS) fail(400, 'MIN_NOTIONAL', 'Order too small: the minimum order value is $5');
  const aq = fm.addQuote(pos, size, price);
  checkLeverage(pos.symbol, aq.size * aq.entryPrice, pos.leverage);
  checkTpsl(pos.side, price, aq.liqPrice, tp, sl);
  const set = {
    size: aq.size,
    entryPrice: aq.entryPrice,
    margin: usd(aq.margin),
    mmr: aq.mmr,
    liqPrice: aq.liqPrice,
    fees: usd(cents(pos.fees) + aq.fee),
    updatedAt: new Date(),
  };
  if (tp != null) set.tp = tp;
  if (sl != null) set.sl = sl;
  return {
    userId,
    kind: 'add',
    deltaCents: -aq.debit,
    targets: [{ model: 'Position', id: pos._id, expect: { status: 'open', size: pos.size, rev: pos.rev ?? null } }],
    post: { [String(pos._id)]: set },
    fee: aq.fee,
  };
}

const findOpenPos = (userId, symbol, side) => Position.findOne({ userId, symbol, side, status: 'open' }).lean();

async function marketOpen(res, { userId, symbol, side, size, leverage, tp, sl }) {
  const { price } = await markNow(symbol);
  const key = `${userId}:${symbol}:${side}`;
  const existing = await findOpenPos(userId, symbol, side);
  let spec;
  let feeCents;
  if (existing) {
    if (existing.lockOp) fail(409, 'POSITION_BUSY', 'Position is being updated, retry in a moment');
    spec = addSpec({ userId, pos: existing, size, price, leverage, tp, sl });
    feeCents = spec.fee;
  } else {
    const q = fm.openQuote(side, size, price, leverage);
    if (q.notional < MIN_NOTIONAL_CENTS) fail(400, 'MIN_NOTIONAL', 'Order too small: the minimum order value is $5');
    checkLeverage(symbol, q.notional / 100, leverage);
    checkTpsl(side, price, q.liqPrice, tp, sl);
    // ponytail: count-then-insert; parallel opens can overshoot the cap by a few (30/min limiter bounds it)
    if ((await Position.countDocuments({ userId, status: { $in: ['opening', 'open'] } })) >= MAX_POSITIONS) fail(400, 'MAX_POSITIONS', `You can have at most ${MAX_POSITIONS} open positions`);
    const id = new mongoose.Types.ObjectId();
    feeCents = q.fee;
    spec = {
      userId,
      kind: 'open',
      deltaCents: -q.debit,
      targets: [{
        model: 'Position',
        id,
        create: {
          userId, symbol, side, size, entryPrice: price, leverage, margin: usd(q.margin), mmr: q.mmr, liqPrice: q.liqPrice,
          tp: tp ?? null, sl: sl ?? null, status: 'opening', activeKey: key, realizedPnl: 0, fees: usd(q.fee), openedAt: new Date(), updatedAt: new Date(),
        },
      }],
      post: { [String(id)]: { status: 'open', updatedAt: new Date() } },
      // lost the activeKey race: someone opened this position meanwhile -> become an add on it
      onDuplicate: async () => {
        const pos = await findOpenPos(userId, symbol, side);
        if (!pos || pos.lockOp) fail(409, 'POSITION_BUSY', 'Position is being updated, retry in a moment');
        const s = addSpec({ userId, pos, size, price, leverage, tp, sl });
        feeCents = s.fee;
        return s;
      },
    };
  }
  const targetId = spec.targets[0].id;
  const r = await ledger.run(spec);
  if (!r.ok) ledgerFail(r);
  const id = r.op && r.op.targets && r.op.targets[0] ? r.op.targets[0].id : targetId; // add-after-duplicate targets the other doc
  const position = await Position.findById(id).lean();
  logger.info(`futures: market ${side} ${size} ${symbol} @ ${price} x${leverage} user=${userId}`);
  res.status(201).json({
    success: true,
    position: position && publicPos(position),
    fill: { price, fee: usd(feeCents) },
    balance: await balanceOf(userId),
  });
}

async function placeLimit(res, { userId, symbol, side, size, leverage, limitPrice, tp, sl }) {
  const q = fm.openQuote(side, size, limitPrice, leverage);
  if (q.notional < MIN_NOTIONAL_CENTS) fail(400, 'MIN_NOTIONAL', 'Order too small: the minimum order value is $5');
  const held = await findOpenPos(userId, symbol, side);
  if (held && held.leverage !== leverage) fail(409, 'LEVERAGE_MISMATCH', `You already hold this position at ${held.leverage}x; add with the same leverage`);
  checkLeverage(symbol, q.notional / 100, leverage);
  checkTpsl(side, limitPrice, q.liqPrice, tp, sl);
  // ponytail: count-then-insert, see marketOpen
  if ((await FuturesOrder.countDocuments({ userId, status: { $in: ['placing', 'open'] } })) >= MAX_ORDERS) fail(400, 'MAX_ORDERS', `You can have at most ${MAX_ORDERS} open orders`);
  const id = new mongoose.Types.ObjectId();
  const r = await ledger.run({
    userId,
    kind: 'place',
    deltaCents: -q.debit,
    targets: [{
      model: 'FuturesOrder',
      id,
      create: { userId, symbol, side, size, leverage, limitPrice, tp: tp ?? null, sl: sl ?? null, reserved: usd(q.debit), status: 'placing', createdAt: new Date() },
    }],
    post: { [String(id)]: { status: 'open' } },
  });
  if (!r.ok) ledgerFail(r);
  logger.info(`futures: limit ${side} ${size} ${symbol} @ ${limitPrice} x${leverage} user=${userId}`);
  res.status(201).json({ success: true, order: await FuturesOrder.findById(id).lean(), balance: await balanceOf(userId) });
}

// POST /api/futures/orders  { symbol, side, type, size, leverage, limitPrice?, tp?, sl? }  (shape checked by futuresOrderRules)
exports.placeOrder = handle(async (req, res, userId) => {
  const b = req.body;
  const size = round8(b.size);
  if (!(size > 0)) fail(422, 'VALIDATION', 'size must be a number greater than 0');
  if (!(await futuresRest.isKnownSymbol(`${b.symbol}USDT`))) fail(400, 'UNKNOWN_MARKET', `Unknown market ${b.symbol}USDT`);
  const args = { userId, symbol: b.symbol, side: b.side, size, leverage: b.leverage, tp: b.tp, sl: b.sl };
  if (b.type === 'limit') return placeLimit(res, { ...args, limitPrice: b.limitPrice });
  return marketOpen(res, args);
});

// DELETE /api/futures/orders/:id  -> credits the reservation back through a 'cancel' op
exports.cancelOrder = handle(async (req, res, userId) => {
  const id = idParam(req);
  const order = await FuturesOrder.findOne({ _id: id, userId }).lean();
  if (!order) fail(404, 'NOT_FOUND', 'Order not found');
  if (order.status !== 'open') fail(409, 'NOT_OPEN', `Order is already ${order.status}`);
  if (order.lockOp) fail(409, 'POSITION_BUSY', 'Order is being updated, retry in a moment');
  const r = await ledger.run({
    userId,
    kind: 'cancel',
    deltaCents: cents(order.reserved),
    targets: [{ model: 'FuturesOrder', id: order._id, expect: { status: 'open', size: order.size } }],
    post: { [String(order._id)]: { status: 'cancelled' } },
  });
  if (!r.ok) {
    if (r.code === 'POSITION_BUSY') { // lost the lock: was it filled/cancelled meanwhile, or just busy?
      const now = await FuturesOrder.findOne({ _id: id, userId }).lean();
      if (now && now.status !== 'open') fail(409, 'NOT_OPEN', `Order is already ${now.status}`);
    }
    ledgerFail(r);
  }
  res.json({ success: true, order: await FuturesOrder.findOne({ _id: id, userId }).lean(), balance: await balanceOf(userId) });
});

// Loads an own position or throws 404.
async function ownPosition(userId, id) {
  const pos = await Position.findOne({ _id: id, userId }).lean();
  if (!pos) fail(404, 'NOT_FOUND', 'Position not found');
  return pos;
}
const requireOpenUnlocked = (pos) => {
  if (pos.status !== 'open') fail(409, 'NOT_OPEN', `Position is already ${pos.status}`);
  if (pos.lockOp) fail(409, 'POSITION_BUSY', 'Position is being updated, retry in a moment');
};

// POST /api/futures/positions/:id/close  { size? }  reduce-only market close at the mark
exports.closePosition = handle(async (req, res, userId) => {
  const id = idParam(req);
  const pos = await ownPosition(userId, id);
  requireOpenUnlocked(pos);
  const closeSize = req.body && req.body.size !== undefined ? round8(req.body.size) : pos.size;
  if (!(closeSize > 0) || closeSize > pos.size) fail(400, 'BAD_SIZE', `size must be between 0 and ${pos.size}`);
  const { price } = await markNow(pos.symbol);
  const isFinal = closeSize === pos.size;
  const remaining = round8(pos.size - closeSize);
  if (!isFinal && notionalCents(remaining, price) < MIN_NOTIONAL_CENTS) fail(400, 'MIN_NOTIONAL', 'The remaining position would be under $5: close all instead');
  const cq = fm.closeQuote(pos, closeSize, price);
  const realizedPnl = usd(cents(pos.realizedPnl) + cq.pnl);
  const fees = usd(cents(pos.fees) + cq.fee);
  const now = new Date();
  const post = isFinal
    ? { status: 'closed', margin: 0, realizedPnl, fees, exitPrice: price, closeReason: 'manual', closedAt: now, updatedAt: now, unset: ['activeKey'] }
    : { size: remaining, margin: usd(cents(pos.margin) - cq.released), realizedPnl, fees, updatedAt: now };
  const r = await ledger.run({
    userId,
    kind: 'close',
    deltaCents: cq.credit,
    targets: [{ model: 'Position', id: pos._id, expect: { status: 'open', size: pos.size, rev: pos.rev ?? null } }],
    post: { [String(pos._id)]: post },
  });
  if (!r.ok) {
    if (r.code === 'POSITION_BUSY') { // a TP/SL/liquidation may have won the claim
      const now2 = await Position.findOne({ _id: id, userId }).lean();
      if (now2 && now2.status !== 'open') fail(409, 'NOT_OPEN', `Position is already ${now2.status}`);
    }
    ledgerFail(r);
  }
  logger.info(`futures: close ${closeSize}/${pos.size} ${pos.symbol} ${pos.side} @ ${price} pnl=${cq.pnl}c user=${userId}`);
  res.json({
    success: true,
    position: await Position.findOne({ _id: id, userId }).lean().then((p) => p && publicPos(p)),
    close: { size: closeSize, price, pnl: usd(cq.pnl), fee: usd(cq.fee), credit: usd(cq.credit) },
    balance: await balanceOf(userId),
  });
});

// PATCH /api/futures/positions/:id  { tp?, sl? }  (null clears). No money moves, so no ledger op: one conditional update
// that fails while an op holds the position (lockOp) or it is no longer open.
exports.editTpsl = handle(async (req, res, userId) => {
  const id = idParam(req);
  const pos = await ownPosition(userId, id);
  requireOpenUnlocked(pos);
  const { price } = await markNow(pos.symbol);
  const set = { updatedAt: new Date() };
  for (const k of ['tp', 'sl']) if (req.body[k] !== undefined) set[k] = req.body[k];
  const m = tpslError(pos.side, price, pos.liqPrice, set.tp, set.sl); // only the keys being changed are checked
  if (m) fail(400, 'BAD_TPSL', m);
  const updated = await Position.findOneAndUpdate({ _id: id, userId, status: 'open', lockOp: null }, { $set: set, $inc: { rev: 1 } }, { new: true }).lean();
  if (!updated) {
    const now = await Position.findOne({ _id: id, userId }).lean();
    if (!now) fail(404, 'NOT_FOUND', 'Position not found');
    if (now.status !== 'open') fail(409, 'NOT_OPEN', `Position is already ${now.status}`);
    fail(409, 'POSITION_BUSY', 'Position is being updated, retry in a moment');
  }
  res.json({ success: true, position: publicPos(updated) });
});
