const mongoose = require('mongoose');
const Trade = require('../models/Trade');
const User = require('../models/User');
const logger = require('../config/logger');
const BaseController = require('./BaseController');
const futuresRest = require('../services/futuresRest');
const futuresService = require('../services/futuresService');

const { MIN_NOTIONAL_CENTS, DUST, round8, quote, avgCost } = require('../services/tradeMath');

const MAX_AMOUNT = 1e9; // base-asset units per order
const WS_MAX_AGE_MS = 3000;
const OVERVIEW_MAX_AGE_MS = 10000;
const EPS = 1e-9; // float dust tolerated when comparing a sell against the held amount
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/; // also guarantees no '.' or '$' reaches a Mongo update path

const r2 = (x) => Math.round(x * 100) / 100;
const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const holdKey = (sym) => {
  if (!SYMBOL_RE.test(sym)) throw new Error('invalid symbol for holdings key');
  return `holdings.${sym}`;
};

// The only price an order is ever filled at: the server's own mark price, never older than it says.
// Order: websocket mark (<= 3s) -> futuresRest.markPrice (cached ~2s) -> overview row (<= 10s) -> null (caller: 503).
// -> { price, ageMs } | null. ageMs is null only for an overview row that carries no timestamp (its cache TTL is 10s).
async function fillPrice(futuresSymbol) {
  const m = futuresService.getMark(futuresSymbol);
  if (m && m.markPrice > 0 && Date.now() - m.ts <= WS_MAX_AGE_MS) return { price: m.markPrice, ageMs: Math.max(0, Date.now() - m.ts) };
  if (typeof futuresRest.markPrice === 'function') {
    try {
      const r = await futuresRest.markPrice(futuresSymbol);
      if (r && r.markPrice > 0 && Number.isFinite(r.ts) && Date.now() - r.ts <= OVERVIEW_MAX_AGE_MS) {
        return { price: r.markPrice, ageMs: Math.max(0, Date.now() - r.ts) };
      }
    } catch (e) {
      logger.warn(`trade: rest mark failed for ${futuresSymbol} (${e.message})`);
    }
  }
  try {
    const row = (await futuresRest.overview()).find((r) => r.symbol === futuresSymbol);
    if (row && row.markPrice > 0) {
      const ageMs = Number.isFinite(row.ts) ? Math.max(0, Date.now() - row.ts) : null;
      if (ageMs === null || ageMs <= OVERVIEW_MAX_AGE_MS) return { price: row.markPrice, ageMs };
    }
  } catch (e) {
    logger.warn(`trade: no mark price for ${futuresSymbol} (${e.message})`);
  }
  return null;
}

// Holdings live on the User document. A user without holdingsSyncedAt gets them computed once from Trade history
// (clamped at >= 0). The conditional update means two concurrent migrations cannot both write. -> false if no such user.
async function ensureHoldings(userId) {
  const u = await User.findById(userId).select('holdingsSyncedAt').lean();
  if (!u) return false;
  if (u.holdingsSyncedAt) return true;
  const isBuy = { $eq: ['$type', 'buy'] };
  const rows = await Trade.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: '$cryptoSymbol', net: { $sum: { $cond: [isBuy, '$amount', { $multiply: ['$amount', -1] }] } } } },
  ]);
  const map = {};
  for (const r of rows) {
    if (!SYMBOL_RE.test(r._id)) {
      logger.warn(`trade: skipped legacy holding with invalid symbol (user=${userId})`);
      continue;
    }
    const net = round8(r.net);
    if (net > DUST) map[r._id] = net;
  }
  await User.updateOne({ _id: userId, holdingsSyncedAt: { $exists: false } }, { $set: { holdings: map, holdingsSyncedAt: new Date() } });
  return true;
}

// [{ symbol, amount, avgCost }] from the User doc's holdings (dust dropped); avgCost walks that symbol's trades.
async function positions(userId, holdingsMap) {
  const entries = Object.entries(holdingsMap || {}).filter(([, a]) => a > DUST);
  if (!entries.length) return [];
  const trades = await Trade.find({ userId, cryptoSymbol: { $in: entries.map(([s]) => s) } })
    .select('cryptoSymbol type amount priceAtTrade date')
    .lean();
  return entries.map(([symbol, amount]) => ({
    symbol,
    amount,
    avgCost: avgCost(trades.filter((t) => t.cryptoSymbol === symbol)),
  }));
}

const userIdOf = (req) => (req.user && mongoose.isValidObjectId(req.user.userId) ? String(req.user.userId) : null);

// POST /api/trades  body: { cryptoSymbol, type, amount }. The user comes from the JWT only; a body userId,
// price or anything else is ignored.
exports.placeTrade = BaseController.wrap(async (req, res) => {
  const userId = userIdOf(req);
  if (!userId) return bad(res, 'Invalid token', 401);

  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const { cryptoSymbol, type } = b;
  if (type !== 'buy' && type !== 'sell') return bad(res, 'type must be buy or sell');
  if (typeof cryptoSymbol !== 'string' || !SYMBOL_RE.test(cryptoSymbol)) return bad(res, 'Invalid cryptoSymbol');
  if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount <= 0 || b.amount > MAX_AMOUNT) {
    return bad(res, 'amount must be a number greater than 0');
  }
  const amount = round8(b.amount);
  if (!(amount > 0)) return bad(res, 'amount must be a number greater than 0');
  const futuresSymbol = `${cryptoSymbol}USDT`;
  if (!(await futuresRest.isKnownSymbol(futuresSymbol))) return bad(res, `Unknown market ${futuresSymbol}`);

  const fill = await fillPrice(futuresSymbol);
  if (!fill) return bad(res, 'No price available for this market right now, try again shortly', 503);
  const { price, ageMs } = fill;

  const q = quote(type, amount, price);
  if (q.notional < MIN_NOTIONAL_CENTS) return bad(res, 'Order too small: the minimum order value is $5');
  const fee = q.fee / 100;
  const total = q.total / 100; // buy: debited, sell: credited
  const record = { userId, cryptoSymbol, type, amount, priceAtTrade: price, fee };
  const key = holdKey(cryptoSymbol);

  if (!(await ensureHoldings(userId))) return bad(res, 'User not found', 404);

  // One conditional update moves balance and holding together, so concurrent orders cannot overdraw or oversell.
  const buy = type === 'buy';
  const user = await User.findOneAndUpdate(
    buy ? { _id: userId, balance: { $gte: total } } : { _id: userId, [key]: { $gte: amount - EPS } },
    { $inc: buy ? { balance: -total, [key]: amount } : { balance: total, [key]: -amount } },
    { new: true, projection: { balance: 1 } },
  );
  if (!user) return bad(res, buy ? 'Insufficient balance' : 'Cannot sell more than you hold');
  try {
    await Trade.create(record);
  } catch (e) {
    try {
      await User.updateOne({ _id: userId }, { $inc: buy ? { balance: total, [key]: -amount } : { balance: -total, [key]: amount } });
    } catch (e2) {
      logger.error(`trade: COMPENSATION FAILED user=${userId} ${type} ${cryptoSymbol} amount=${amount} total=${total}: ${e2.message}`);
    }
    logger.error(`trade: insert failed after ${type} update, reversed (user=${userId}): ${e.message}`);
    throw e;
  }

  logger.info(`trade: ${type} ${amount} ${cryptoSymbol} @ ${price} user=${userId}`);
  res.status(201).json({
    success: true,
    message: 'Trade successful',
    fill: { symbol: cryptoSymbol, type, amount, price, priceAgeMs: ageMs, fee, total },
    balance: r2(user.balance),
  });
});

// GET /api/trades?limit=  own trades, newest first (limit 1..100, default 50)
exports.listTrades = BaseController.wrap(async (req, res) => {
  const userId = userIdOf(req);
  if (!userId) return bad(res, 'Invalid token', 401);
  const n = Math.min(Math.max(parseInt(req.query && req.query.limit, 10) || 50, 1), 100);
  const trades = await Trade.find({ userId }).sort({ date: -1 }).limit(n).lean();
  res.json({ success: true, trades });
});

// GET /api/trades/portfolio -> { balance, holdings: [{ symbol, amount, avgCost }] }
exports.portfolio = BaseController.wrap(async (req, res) => {
  const userId = userIdOf(req);
  if (!userId) return bad(res, 'Invalid token', 401);
  if (!(await ensureHoldings(userId))) return bad(res, 'User not found', 404);
  const user = await User.findById(userId).select('balance holdings').lean();
  if (!user) return bad(res, 'User not found', 404);
  res.json({ success: true, balance: r2(user.balance), holdings: await positions(userId, user.holdings) });
});
