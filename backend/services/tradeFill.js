// Fill logic shared by market orders (tradeController) and limit orders (orderMatcher): price source, holdings
// bootstrap and the one conditional balance+holding update that settles a trade.
const mongoose = require('mongoose');
const Trade = require('../models/Trade');
const User = require('../models/User');
const logger = require('../config/logger');
const futuresRest = require('./futuresRest');
const futuresService = require('./futuresService');
const { DUST, round8, quote } = require('./tradeMath');

const WS_MAX_AGE_MS = 3000;
const OVERVIEW_MAX_AGE_MS = 10000;
const EPS = 1e-9; // float dust tolerated when comparing a sell against the held amount
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/; // also guarantees no '.' or '$' reaches a Mongo update path

const holdKey = (sym) => {
  if (!SYMBOL_RE.test(sym)) throw new Error('invalid symbol for holdings key');
  return `holdings.${sym}`;
};
const userIdOf = (req) => (req.user && mongoose.isValidObjectId(req.user.userId) ? String(req.user.userId) : null);

// The only price a market order is ever filled at: the server's own mark price, never older than it says.
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

const negate = (inc) => Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, -v]));

// Settles one fill at `price`: ONE update moves balance and holding together (so concurrent orders cannot overdraw or
// oversell), then records the Trade; if that insert fails the update is reversed.
// reserved == null: market order, the update is conditional on funds / holding.
// reserved != null: limit order whose funds were taken at placement (buy: USD reserved, the unused part is refunded;
// sell: the coins were already removed), so the update is unconditional.
// -> { balance, fee, total } | null (market order the user cannot afford / no such user).
async function executeFill({ userId, symbol, type, amount, price, reserved = null, orderId = null }) {
  const q = quote(type, amount, price);
  const fee = q.fee / 100;
  const total = q.total / 100; // buy: debited, sell: credited
  const key = holdKey(symbol);
  const buy = type === 'buy';
  let filter = { _id: userId };
  let inc;
  if (reserved != null) inc = buy ? { balance: reserved - total, [key]: amount } : { balance: total };
  else if (buy) { filter = { _id: userId, balance: { $gte: total } }; inc = { balance: -total, [key]: amount }; }
  else { filter = { _id: userId, [key]: { $gte: amount - EPS } }; inc = { balance: total, [key]: -amount }; }

  const user = await User.findOneAndUpdate(filter, { $inc: inc }, { new: true, projection: { balance: 1 } });
  if (!user) return null;
  try {
    await Trade.create({ userId, cryptoSymbol: symbol, type, amount, priceAtTrade: price, fee, ...(orderId && { orderId }) });
  } catch (e) {
    try {
      await User.updateOne({ _id: userId }, { $inc: negate(inc) });
    } catch (e2) {
      logger.error(`trade: COMPENSATION FAILED user=${userId} ${type} ${symbol} amount=${amount} total=${total}: ${e2.message}`);
      e.compensationFailed = true; // the user update stays applied with no Trade: callers must not retry the settle
    }
    logger.error(`trade: insert failed after ${type} update, reversed (user=${userId}): ${e.message}`);
    throw e;
  }
  return { balance: user.balance, fee, total };
}

// Gives a limit order's reservation back (buy: dollars to balance, sell: coins to holdings). -> { balance } | null.
// Callers must have won the status flip first so it runs at most once per order.
const releaseReservation = ({ userId, side, symbol, reserved }) => User.findOneAndUpdate(
  { _id: userId },
  { $inc: side === 'buy' ? { balance: reserved } : { [holdKey(symbol)]: reserved } },
  { new: true, projection: { balance: 1 } },
);

module.exports = { releaseReservation, EPS, SYMBOL_RE, holdKey, userIdOf, fillPrice, ensureHoldings, executeFill };
