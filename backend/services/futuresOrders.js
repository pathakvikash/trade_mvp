// Market open / close for leveraged paper futures, shared by the HTTP controller and the bot engine. Every balance and
// position change goes through futuresLedger.run(opSpec); fills are at tradeFill.fillPrice (the Binance mark), money is
// integer cents. Throws ApiError (status, code, message); the controller maps it to HTTP. Moved out of
// futuresController.js unchanged in behaviour; bot-trading-plan.md WP0.
const mongoose = require('mongoose');
const Position = require('../models/Position');
const logger = require('../config/logger');
const ledger = require('./futuresLedger');
const fm = require('./futuresMath');
const { fillPrice } = require('./tradeFill');
const { MIN_NOTIONAL_CENTS, round8, notionalCents } = require('./tradeMath');

const MAX_POSITIONS = 20;
const OID = /^[a-f0-9]{24}$/i;

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

// A retry (or a racing twin) that reuses a caller-chosen positionId: only an OPEN position of the same symbol/side/bot is a
// fill already done. opening = the first attempt is still running (retry later); void = it failed (surface its error);
// closed = not an open at all. Never returns a doc that did not really fill.
async function replay(userId, done, { symbol, side, botId }) {
  if (done.status === 'open') {
    if (done.symbol !== symbol || done.side !== side || String(done.botId || '') !== String(botId || '')) fail(409, 'POSITION_CONFLICT', 'positionId is already used by a different position');
    return { position: done, fill: { price: done.entryPrice, feeCents: cents(done.fees) } };
  }
  if (done.status === 'opening') fail(409, 'POSITION_BUSY', 'Position is being opened, retry in a moment');
  if (done.status === 'void') {
    const op = await require('../models/FuturesOp').findOne({ userId, 'targets.id': done._id }).sort({ createdAt: -1 }).lean();
    ledgerFail({ code: op && op.lastError, op });
  }
  fail(409, 'NOT_OPEN', `Position is already ${done.status}`);
}

// openMarket({ userId, symbol, side, size, leverage, tp, sl, positionId?, botId?, noAdd? }) -> { position, fill: { price, feeCents } }
// positionId: caller-chosen id of the new position; a retry with the same id returns the existing OPEN one and debits nothing.
// stopPct / targetPct (percent): SL/TP are derived from the ACTUAL fill price, overriding sl/tp. maxNotionalCents: a size whose
// notional at the fill price exceeds it is a 409 PRICE_MOVED (the caller sized it from an older mark). Bots use all three.
// noAdd: an existing position on the same user+symbol+side (also one that wins the activeKey race) is a 409 POSITION_CONFLICT, never an add.
async function openMarket({ userId, symbol, side, size, leverage, tp, sl, positionId, botId, noAdd, stopPct, targetPct, maxNotionalCents }) {
  if (positionId) {
    const done = await Position.findOne({ _id: positionId, userId }).lean();
    if (done) return replay(userId, done, { symbol, side, botId });
  }
  const { price } = await markNow(symbol);
  if (maxNotionalCents != null && notionalCents(size, price) > maxNotionalCents) fail(409, 'PRICE_MOVED', 'The price moved: the order would exceed its notional cap');
  const px = (x) => Number(x.toPrecision(10));
  const up = side === 'long' ? 1 : -1;
  if (stopPct != null) sl = px(price * (1 - (up * stopPct) / 100));
  if (targetPct != null) tp = px(price * (1 + (up * targetPct) / 100));
  const key = `${userId}:${symbol}:${side}`;
  const existing = await findOpenPos(userId, symbol, side);
  const conflict = () => fail(409, 'POSITION_CONFLICT', 'A position on this market and side already exists');
  let spec;
  let feeCents;
  if (existing) {
    if (noAdd) conflict();
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
    const id = positionId ? new mongoose.Types.ObjectId(positionId) : new mongoose.Types.ObjectId();
    feeCents = q.fee;
    const create = {
      userId, symbol, side, size, entryPrice: price, leverage, margin: usd(q.margin), mmr: q.mmr, liqPrice: q.liqPrice,
      tp: tp ?? null, sl: sl ?? null, status: 'opening', activeKey: key, realizedPnl: 0, fees: usd(q.fee), openedAt: new Date(), updatedAt: new Date(),
    };
    if (botId) create.botId = botId;
    spec = {
      userId,
      kind: 'open',
      deltaCents: -q.debit,
      targets: [{ model: 'Position', id, create }],
      post: { [String(id)]: { status: 'open', updatedAt: new Date() } },
      // lost the activeKey race: someone opened this position meanwhile -> become an add on it
      onDuplicate: async () => {
        // same positionId raced us (E11000 on _id): that is a twin of this very open, never an add -> idempotent answer first
        if (positionId) {
          const twin = await Position.findOne({ _id: positionId, userId }).lean();
          if (twin) throw Object.assign(new Error('replay'), { replay: await replay(userId, twin, { symbol, side, botId }) });
        }
        if (noAdd) conflict();
        const pos = await findOpenPos(userId, symbol, side);
        if (!pos || pos.lockOp) fail(409, 'POSITION_BUSY', 'Position is being updated, retry in a moment');
        const s = addSpec({ userId, pos, size, price, leverage, tp, sl });
        feeCents = s.fee;
        return s;
      },
    };
  }
  const targetId = spec.targets[0].id;
  let r;
  try {
    r = await ledger.run(spec);
  } catch (e) {
    if (e && e.replay) return e.replay;
    throw e;
  }
  if (!r.ok) ledgerFail(r);
  const id = r.op && r.op.targets && r.op.targets[0] ? r.op.targets[0].id : targetId; // add-after-duplicate targets the other doc
  const position = await Position.findById(id).lean();
  logger.info(`futures: market ${side} ${size} ${symbol} @ ${price} x${leverage} user=${userId}`);
  return { position, fill: { price, feeCents } };
}

// closeMarket({ userId, positionId, size?, reason = 'manual' }) -> { position, close: { size, price, pnlCents, feeCents, creditCents } }
// Reduce-only market close at the mark; reason ('manual' | 'bot') is stored as closeReason on a final close.
async function closeMarket({ userId, positionId, size, reason = 'manual' }) {
  const id = positionId;
  const pos = await ownPosition(userId, id);
  requireOpenUnlocked(pos);
  const closeSize = size !== undefined ? round8(size) : pos.size;
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
    ? { status: 'closed', margin: 0, realizedPnl, fees, exitPrice: price, closeReason: reason, closedAt: now, updatedAt: now, unset: ['activeKey'] }
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
  return {
    position: await Position.findOne({ _id: id, userId }).lean(),
    close: { size: closeSize, price, pnlCents: cq.pnl, feeCents: cq.fee, creditCents: cq.credit },
  };
}

module.exports = { openMarket, closeMarket, ApiError, fail, markNow, tpslError, checkTpsl, checkLeverage, ledgerFail, findOpenPos, ownPosition, requireOpenUnlocked };
