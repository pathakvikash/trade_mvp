const Trade = require('../models/Trade');
const User = require('../models/User');
const logger = require('../config/logger');
const BaseController = require('./BaseController');
const futuresRest = require('../services/futuresRest');
const Order = require('../models/Order');
const { EPS, SYMBOL_RE, holdKey, userIdOf, fillPrice, ensureHoldings, executeFill } = require('../services/tradeFill');

const { MIN_NOTIONAL_CENTS, DUST, round8, quote, avgCost } = require('../services/tradeMath');

const MAX_AMOUNT = 1e9; // base-asset units per order
const MAX_OPEN_ORDERS = 20;

const r2 = (x) => Math.round(x * 100) / 100;
const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

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

// Limit order: nothing fills now. The funds are reserved with one conditional update (buy: USD incl. fee; sell: the coins,
// so they cannot be sold twice) and an open Order is stored; services/orderMatcher fills it at the limit price.
async function placeLimit(res, { userId, cryptoSymbol, type, amount, limitPrice }) {
  if (typeof limitPrice !== 'number' || !Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice > MAX_AMOUNT) {
    return bad(res, 'limitPrice must be a number greater than 0', 422);
  }
  const q = quote(type, amount, limitPrice);
  if (q.notional < MIN_NOTIONAL_CENTS) return bad(res, 'Order too small: the minimum order value is $5');
  if (!(await ensureHoldings(userId))) return bad(res, 'User not found', 404);
  // ponytail: count-then-insert, so parallel requests can overshoot the cap by a few; the 30/min limiter bounds it.
  if ((await Order.countDocuments({ userId, status: 'open' })) >= MAX_OPEN_ORDERS) return bad(res, `You can have at most ${MAX_OPEN_ORDERS} open orders`);

  const buy = type === 'buy';
  const key = holdKey(cryptoSymbol);
  const reserved = buy ? q.total / 100 : amount;
  const inc = buy ? { balance: -reserved } : { [key]: -amount };
  const user = await User.findOneAndUpdate(
    buy ? { _id: userId, balance: { $gte: reserved } } : { _id: userId, [key]: { $gte: amount - EPS } },
    { $inc: inc },
    { new: true, projection: { balance: 1 } },
  );
  if (!user) return bad(res, buy ? 'Insufficient balance' : 'Cannot sell more than you hold');
  let order;
  try {
    order = await Order.create({ userId, symbol: cryptoSymbol, side: type, type: 'limit', amount, limitPrice, reserved });
  } catch (e) {
    try {
      await User.updateOne({ _id: userId }, { $inc: { [buy ? 'balance' : key]: reserved } });
    } catch (e2) {
      logger.error(`order: COMPENSATION FAILED user=${userId} ${type} ${cryptoSymbol} reserved=${reserved}: ${e2.message}`);
    }
    throw e;
  }
  logger.info(`order: limit ${type} ${amount} ${cryptoSymbol} @ ${limitPrice} user=${userId}`);
  res.status(201).json({ success: true, order, balance: r2(user.balance) });
}

// POST /api/trades  body: { cryptoSymbol, type, amount, orderType?: 'market' (default) | 'limit', limitPrice? (limit only) }.
// The user comes from the JWT only; a body userId or anything else is ignored. Market orders fill now at the server's mark
// price; limit orders are reserved and filled later (see placeLimit).
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
  const orderType = b.orderType === undefined ? 'market' : b.orderType;
  if (orderType !== 'market' && orderType !== 'limit') return bad(res, "orderType must be 'market' or 'limit'", 422);
  const futuresSymbol = `${cryptoSymbol}USDT`;
  if (!(await futuresRest.isKnownSymbol(futuresSymbol))) return bad(res, `Unknown market ${futuresSymbol}`);

  if (orderType === 'limit') return placeLimit(res, { userId, cryptoSymbol, type, amount, limitPrice: b.limitPrice });

  const fill = await fillPrice(futuresSymbol);
  if (!fill) return bad(res, 'No price available for this market right now, try again shortly', 503);
  const { price, ageMs } = fill;

  const q = quote(type, amount, price);
  if (q.notional < MIN_NOTIONAL_CENTS) return bad(res, 'Order too small: the minimum order value is $5');
  if (!(await ensureHoldings(userId))) return bad(res, 'User not found', 404);

  const done = await executeFill({ userId, symbol: cryptoSymbol, type, amount, price });
  if (!done) return bad(res, type === 'buy' ? 'Insufficient balance' : 'Cannot sell more than you hold');

  logger.info(`trade: ${type} ${amount} ${cryptoSymbol} @ ${price} user=${userId}`);
  res.status(201).json({
    success: true,
    message: 'Trade successful',
    fill: { symbol: cryptoSymbol, type, amount, price, priceAgeMs: ageMs, fee: done.fee, total: done.total },
    balance: r2(done.balance),
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
