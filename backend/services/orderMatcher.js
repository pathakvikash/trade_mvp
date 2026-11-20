// Limit-order matcher: every ~2s checks open orders against the server's mark price (same source as market fills).
// A buy fills when mark <= limitPrice, a sell when mark >= limitPrice. The fill price is the LIMIT price, not the mark:
// the order was reserved at that price, so a limit order never costs more (or pays less) than the user asked for.
const mongoose = require('mongoose');
const Order = require('../models/Order');
const logger = require('../config/logger');
const Trade = require('../models/Trade');
const { fillPrice, executeFill, releaseReservation } = require('./tradeFill');

const EVERY_MS = 2000;
const MAX_FAILURES = 3; // clean settle failures before an order is rejected and refunded
const PASS_LIMIT = 1000; // open orders loaded per pass (oldest first); the rest wait for later passes
const SWEEP_WINDOW_MS = 24 * 3600 * 1000;
let timer = null;
let current = null; // the in-flight pass; a slow pass must never overlap the next one

const crosses = (o, mark) => (o.side === 'buy' ? mark <= o.limitPrice : mark >= o.limitPrice);

// Reopens a claimed order after a clean failed settle; the 3rd failure rejects it and refunds the reservation.
async function reopenOrRefuse(o) {
  const upd = await Order.findOneAndUpdate(
    { _id: o._id, status: 'filled' },
    { $set: { status: 'open' }, $unset: { fillPrice: 1, filledAt: 1 }, $inc: { failures: 1 } },
    { new: true },
  );
  if (!upd || upd.failures < MAX_FAILURES) return;
  // the open -> rejected flip is the claim: a concurrent cancel and this refund cannot both release
  const rejected = await Order.findOneAndUpdate({ _id: o._id, status: 'open' }, { $set: { status: 'rejected' } });
  if (!rejected) return;
  try {
    await releaseReservation(o);
    logger.error(`order: rejected ${o._id} after ${MAX_FAILURES} failed settles, reservation refunded user=${o.userId}`);
  } catch (e) {
    await Order.updateOne({ _id: o._id, status: 'rejected' }, { $set: { status: 'open' } }).catch(() => {}); // retried next failure
    logger.error(`order: refund failed on reject ${o._id} user=${o.userId}: ${e.message}`);
  }
}

// Fills one open order. The conditional open -> filled update is the claim: of any number of concurrent matchers
// (or a cancel) exactly one gets the order, so it cannot be filled twice. -> true if this call filled it.
async function fillOrder(o) {
  const claimed = await Order.findOneAndUpdate(
    { _id: o._id, status: 'open' },
    { $set: { status: 'filled', fillPrice: o.limitPrice, filledAt: new Date() } },
  );
  if (!claimed) return false;
  try {
    const done = await executeFill({ userId: String(o.userId), symbol: o.symbol, type: o.side, amount: o.amount, price: o.limitPrice, reserved: o.reserved, orderId: o._id });
    if (!done) { // account is gone: nothing to settle
      await Order.updateOne({ _id: o._id }, { $set: { status: 'rejected' }, $unset: { fillPrice: 1, filledAt: 1 } });
      return false;
    }
    logger.info(`order: filled limit ${o.side} ${o.amount} ${o.symbol} @ ${o.limitPrice} user=${o.userId}`);
    return true;
  } catch (e) {
    if (e.compensationFailed) {
      // the settle is applied but unrecorded and could not be reversed: retrying would settle twice. Park it for a human.
      await Order.updateOne({ _id: o._id }, { $set: { status: 'error' } }).catch(() => {});
      logger.error(`order: ${o._id} parked as error, settle applied but not reversed, manual review user=${o.userId}: ${e.message}`);
      return false;
    }
    // executeFill already reversed its update; reopen so the next pass retries
    try {
      await reopenOrRefuse(o);
    } catch (e2) {
      logger.error(`order: could not reopen ${o._id} after failed fill user=${o.userId}: ${e2.message}`);
    }
    logger.error(`order: fill failed ${o._id}: ${e.message}`);
    return false;
  }
}

async function pass() {
  try {
    const open = await Order.find({ status: 'open' }).sort({ createdAt: 1 }).limit(PASS_LIMIT).lean();
    const bySymbol = new Map();
    for (const o of open) {
      const list = bySymbol.get(o.symbol);
      if (list) list.push(o); else bySymbol.set(o.symbol, [o]);
    }
    for (const [symbol, orders] of bySymbol) {
      let fill = null;
      try {
        fill = await fillPrice(`${symbol}USDT`);
      } catch (e) {
        logger.warn(`order: price lookup failed for ${symbol}: ${e.message}`);
      }
      if (!fill) continue;
      for (const o of orders) if (crosses(o, fill.price)) await fillOrder(o);
    }
  } catch (e) {
    logger.error(`orderMatcher pass failed: ${e.message}`);
  }
}

// One pass. Symbols with no fresh price are skipped until the next pass. -> the pass's promise (never rejects).
function runOnce() {
  if (!current) current = pass().finally(() => { current = null; });
  return current;
}

// Startup: orders filled in the last 24h with no Trade linked to them are either pre-orderId fills or a settle that
// lost its Trade. Surfaced only, never refunded (ambiguous). Non-fatal.
async function sweepOrphans() {
  try {
    const filled = await Order.find({ status: 'filled', filledAt: { $gte: new Date(Date.now() - SWEEP_WINDOW_MS) } }).limit(PASS_LIMIT).lean();
    if (!filled.length) return;
    const have = new Set((await Trade.find({ orderId: { $in: filled.map((o) => o._id) } }).select('orderId').lean()).map((t) => String(t.orderId)));
    for (const o of filled) {
      if (!have.has(String(o._id))) logger.error(`ORPHANED FILLED ORDER ${o._id} user=${o.userId} ${o.side} ${o.amount} ${o.symbol} filledAt=${o.filledAt}: no Trade found, manual review`);
    }
  } catch (e) {
    logger.warn(`order: orphan sweep failed: ${e.message}`);
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { if (mongoose.connection.readyState === 1) runOnce(); }, EVERY_MS);
  if (timer.unref) timer.unref();
  const sweep = () => { if (mongoose.connection.readyState === 1) sweepOrphans(); else setTimeout(sweep, EVERY_MS).unref(); };
  sweep();
  logger.info('orderMatcher started');
}

// -> promise that resolves when any in-flight pass has finished
function stop() {
  clearInterval(timer);
  timer = null;
  return current || Promise.resolve();
}

module.exports = { start, stop, runOnce, sweepOrphans, _test: { fillOrder, crosses } };
