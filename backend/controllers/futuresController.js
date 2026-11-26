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
const orders = require('../services/futuresOrders');
const { ApiError, fail, markNow, tpslError, checkTpsl, checkLeverage, ledgerFail, findOpenPos, ownPosition, requireOpenUnlocked } = orders;
const { userIdOf } = require('../services/tradeFill');
const { MIN_NOTIONAL_CENTS, round8 } = require('../services/tradeMath');

const MAX_POSITIONS = 20;
const MAX_ORDERS = 20;
const MARK_MAX_AGE_MS = 3000;
const OID = /^[a-f0-9]{24}$/i;

const r2 = (x) => Math.round(x * 100) / 100;
const usd = (cents) => cents / 100;
const cents = (dollars) => Math.round(dollars * 100);

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
async function marketOpen(res, args) {
  const { position, fill } = await orders.openMarket(args);
  res.status(201).json({ success: true, position: position && publicPos(position), fill: { price: fill.price, fee: usd(fill.feeCents) }, balance: await balanceOf(args.userId) });
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

// POST /api/futures/positions/:id/close  { size? }  reduce-only market close at the mark
exports.closePosition = handle(async (req, res, userId) => {
  const id = idParam(req);
  const { position, close } = await orders.closeMarket({ userId, positionId: id, size: req.body ? req.body.size : undefined });
  res.json({
    success: true,
    position: position && publicPos(position),
    close: { size: close.size, price: close.price, pnl: usd(close.pnlCents), fee: usd(close.feeCents), credit: usd(close.creditCents) },
    balance: await balanceOf(userId),
  });
});

// PATCH /api/futures/positions/:id  { tp?, sl?, leverage? }  (tp/sl null clears).
// TP/SL only: no money moves, so no ledger op: one conditional update that fails while an op holds the position (lockOp)
// or it is no longer open. With a changed leverage: one 'leverage' ledger op that re-sizes the isolated margin
// (ceil(entry notional / leverage), the open rule), credits/debits the difference and writes tp/sl in the same frozen
// post, so both apply or neither does.
exports.editPosition = handle(async (req, res, userId) => {
  const id = idParam(req);
  const pos = await ownPosition(userId, id);
  requireOpenUnlocked(pos);
  const { price } = await markNow(pos.symbol);
  const b = req.body;
  const set = { updatedAt: new Date() };
  for (const k of ['tp', 'sl']) if (b[k] !== undefined) set[k] = b[k];
  const lev = b.leverage !== undefined && b.leverage !== pos.leverage ? b.leverage : null; // same leverage = no-op

  if (lev == null) {
    if (!('tp' in set) && !('sl' in set)) return res.json({ success: true, position: publicPos(pos), balance: await balanceOf(userId), marginDelta: 0 });
    const m = tpslError(pos.side, price, pos.liqPrice, set.tp, set.sl); // only the keys being changed are checked
    if (m) fail(400, 'BAD_TPSL', m);
    const updated = await Position.findOneAndUpdate({ _id: id, userId, status: 'open', lockOp: null }, { $set: set, $inc: { rev: 1 } }, { new: true }).lean();
    if (!updated) {
      const now = await Position.findOne({ _id: id, userId }).lean();
      if (!now) fail(404, 'NOT_FOUND', 'Position not found');
      if (now.status !== 'open') fail(409, 'NOT_OPEN', `Position is already ${now.status}`);
      fail(409, 'POSITION_BUSY', 'Position is being updated, retry in a moment');
    }
    return res.json({ success: true, position: publicPos(updated), balance: await balanceOf(userId), marginDelta: 0 });
  }

  checkLeverage(pos.symbol, pos.size * pos.entryPrice, lev);
  const lq = fm.leverageQuote(pos, lev);
  const long = pos.side === 'long';
  if (long ? lq.liqPrice >= price : lq.liqPrice <= price) {
    fail(400, 'LIQ_BREACH', `At ${lev}x the liquidation price ${lq.liqPrice} would be at or past the mark ${price}: the position would be liquidated at once`);
  }
  // The stop loss that will be in force (new or kept) must still sit between the new liq and the mark.
  checkTpsl(pos.side, price, lq.liqPrice, set.tp, 'sl' in set ? set.sl : pos.sl);
  const r = await ledger.run({
    userId,
    kind: 'leverage',
    deltaCents: lq.delta,
    targets: [{ model: 'Position', id: pos._id, expect: { status: 'open', size: pos.size, rev: pos.rev ?? null } }],
    post: { [String(pos._id)]: { ...set, leverage: lev, margin: usd(lq.margin), liqPrice: lq.liqPrice } },
  });
  if (!r.ok) {
    if (r.code === 'POSITION_BUSY') { // a close/TP/SL/liquidation may have won the claim
      const now = await Position.findOne({ _id: id, userId }).lean();
      if (now && now.status !== 'open') fail(409, 'NOT_OPEN', `Position is already ${now.status}`);
    }
    ledgerFail(r);
  }
  logger.info(`futures: leverage ${pos.leverage}x -> ${lev}x ${pos.symbol} ${pos.side} delta=${lq.delta}c user=${userId}`);
  res.json({
    success: true,
    position: await Position.findOne({ _id: id, userId }).lean().then((p) => p && publicPos(p)),
    balance: await balanceOf(userId),
    marginDelta: usd(lq.delta),
  });
});

// PATCH /api/futures/orders/:id  { tp?, sl? }  on an open limit order. The reservation depends only on price, size and
// leverage, so no money moves: one conditional update while unlocked and open. The risk engine pins tp/sl in its fill
// lock filter, so an edit racing a fill either lands before it (copied to the position) or makes the fill retry.
exports.editOrderTpsl = handle(async (req, res, userId) => {
  const id = idParam(req);
  const order = await FuturesOrder.findOne({ _id: id, userId }).lean();
  if (!order) fail(404, 'NOT_FOUND', 'Order not found');
  if (order.status !== 'open') fail(409, 'NOT_OPEN', `Order is already ${order.status}`);
  if (order.lockOp) fail(409, 'POSITION_BUSY', 'Order is being updated, retry in a moment');
  const set = {};
  for (const k of ['tp', 'sl']) if (req.body[k] !== undefined) set[k] = req.body[k];
  const q = fm.openQuote(order.side, order.size, order.limitPrice, order.leverage);
  // same rule as placement: vs the limit price and the quoted liq, with the values that will be in force
  checkTpsl(order.side, order.limitPrice, q.liqPrice, 'tp' in set ? set.tp : order.tp, 'sl' in set ? set.sl : order.sl);
  const updated = await FuturesOrder.findOneAndUpdate({ _id: id, userId, status: 'open', lockOp: null }, { $set: set }, { new: true }).lean();
  if (!updated) {
    const now = await FuturesOrder.findOne({ _id: id, userId }).lean();
    if (now && now.status !== 'open') fail(409, 'NOT_OPEN', `Order is already ${now.status}`);
    fail(409, 'POSITION_BUSY', 'Order is being updated, retry in a moment');
  }
  res.json({ success: true, order: updated });
});
