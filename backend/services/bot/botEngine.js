// Bot engine: a 5 s tick loop in the orderMatcher style (start/stop/runOnce, one in-flight pass, unref'd timer, skip unless
// Mongo is up). Per running bot: re-verify the accept hash, read closed Binance-sourced candles, signalAt, riskGuard.check,
// claim the bar with a BotDecision `intent` row (the unique {botId, barTime} index IS the claim) BEFORE ordering, then
// futuresOrders.openMarket / closeMarket. No other money path: no ledger, no User, no AI or news code (a test checks the
// require list). Stops and targets are position TP/SL executed by the risk engine. Plan: context/bot-trading-plan.md section 2.
const mongoose = require('mongoose');
const Bot = require('../../models/Bot');
const BotDecision = require('../../models/BotDecision');
const Position = require('../../models/Position');
const logger = require('../../config/logger');
const futuresRest = require('../futuresRest');
const { fillPrice } = require('../tradeFill');
const orders = require('../futuresOrders');
const { unrealized } = require('../futuresMath');
const { notionalCents, round8 } = require('../tradeMath');
const { signalAt } = require('../strategy/evaluate');
const { parseSpec, EVAL_SECONDS } = require('../strategy/schema');
const { botHash } = require('../strategy/hash');
const guard = require('./riskGuard');

const EVERY_MS = 5000;
const INTENT_AGE_MS = 30 * 1000; // past the ledger's 15 s recovery gate
const WINDOW_MS = 60 * 1000; // a closed bar may be decided until this long after its close, then it is `missed`
const MAX_ERRORS = 10; // consecutive failed ticks before a bot is paused
const MAX_BALANCE_FAILS = 3;
const CANDLE_SOURCES = [undefined, 'binance', 'binance-futures', 'spot']; // Binance futures, else the Binance spot mirror
let timer = null;
const MARK_TTL_MS = 1000; // a mark older than this is refetched, so sizing and the kill switch never act on a stale one
const PAGE = 200; // bots per Mongo page of a pass (the pass walks ALL pages with an _id cursor)
let current = null; // the in-flight pass; a slow pass must never overlap the next one
let stopping = false; // set by stop(): the loop returns before each bot and before any order

// Same default as routes/botRoutes: on in development/test, off in production until the owner sets BOTS_ENABLED=true.
const enabled = () => {
  const v = String(process.env.BOTS_ENABLED || '').trim().toLowerCase();
  return v ? v === 'true' : process.env.NODE_ENV !== 'production';
};

const cents = (usd) => Math.round(usd * 100);
const isDup = (e) => e && (e.code === 11000 || /E11000/.test(String(e.message)));
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const newId = () => new mongoose.Types.ObjectId();

// ---- decision reasons: built from signalAt's conds, never from model text ----
const OPS = { gt: '>', gte: '>=', lt: '<', lte: '<=', crosses_above: 'crosses above', crosses_below: 'crosses below' };
const operandText = (r) => (typeof r === 'number' ? String(r) : typeof r === 'string' ? r : `${r.ref} x ${r.mul}`);
const condsOf = (sig, groups) => groups.flatMap((g) => (sig.conds[g] || []).map((c) => ({
  group: g, text: `${c.left} ${OPS[c.op] || c.op} ${operandText(c.right)}`, left: num(c.leftValue), right: num(c.rightValue), ok: !!c.met,
})));

// ---- audit rows ----
const risk = (bot, reason) => BotDecision.create({ botId: bot._id, userId: bot.userId, kind: 'risk', reason, at: new Date(Date.now()) })
  .catch((e) => logger.warn(`bot risk log failed: ${e.message}`));

// Inserts the per-bar tick row. null = the bar was already decided (E11000): the caller stops.
async function claim(bot, barTime, fields) {
  try {
    return await BotDecision.create({ botId: bot._id, userId: bot.userId, kind: 'tick', barTime, at: new Date(Date.now()), ...fields });
  } catch (e) {
    if (isDup(e)) return null;
    throw e;
  }
}
const advance = (bot, barTime) => Bot.updateOne({ _id: bot._id, lastBarTime: { $lt: barTime } }, { $set: { lastBarTime: barTime, updatedAt: new Date(Date.now()) } });
const finish = (d, set) => BotDecision.updateOne({ _id: d._id, status: 'intent' }, { $set: set });

// Clears the bot's position and books its net P&L into today's counters. The `positionId` filter makes it happen exactly
// once however many paths (settle, observed, recovery) race to do it. -> true if this call released it.
async function release(botId, positionId, pos) {
  const net = pos ? cents(pos.realizedPnl || 0) - cents(pos.fees || 0) : 0;
  const key = guard.dayKey(Date.now());
  await Bot.updateOne({ _id: botId, 'day.key': { $lt: key } }, { $set: { day: { key, trades: 0, realizedCents: 0 } } });
  const r = await Bot.updateOne({ _id: botId, positionId }, { $set: { positionId: null, entryBarTime: null }, $inc: { 'day.realizedCents': net } });
  return !!(r && (r.modifiedCount || r.nModified));
}

// A position of the bot is no longer open (TP/SL/liquidation/manual close/our own close): book it, log it, and block a
// same-bar re-entry by advancing lastBarTime.
async function observeClosed(bot, pos, barTime) {
  const positionId = pos ? pos._id : bot.positionId;
  if (!(await release(bot._id, positionId, pos))) return;
  const d = await BotDecision.findOne({ botId: bot._id, positionId, action: 'close', status: 'intent' }).lean();
  if (d) await finish(d, { status: 'done', fillPrice: pos && pos.exitPrice, pnlCents: pos ? cents(pos.realizedPnl || 0) : 0 });
  else {
    await BotDecision.create({ botId: bot._id, userId: bot.userId, kind: 'observed', positionId, at: new Date(Date.now()), reason: { closeReason: (pos && (pos.closeReason || pos.status)) || 'unknown' }, fillPrice: pos && pos.exitPrice, pnlCents: pos ? cents(pos.realizedPnl || 0) : 0 });
  }
  if (barTime) await advance(bot, barTime);
}

// ---- helpers ----
// Cached per pass for MARK_TTL_MS only (a pass over many bots can take seconds). null = no usable mark.
async function markOf(ctx, symbol) {
  const hit = ctx.marks.get(symbol);
  if (hit && Date.now() - hit.t < MARK_TTL_MS) return hit.m;
  const t = Date.now(); // stamped before the fetch: a slow fetch only makes the entry look older
  let m = null;
  try { const f = await fillPrice(`${symbol}USDT`); m = f && f.price > 0 ? f.price : null; } catch (e) { m = null; }
  ctx.marks.set(symbol, { m, t });
  return m;
}
async function allowedOf(ctx) {
  if (!ctx.allowed) {
    try { ctx.allowed = (await futuresRest.overview()).map((r) => String(r.symbol).replace(/USDT$/, '')); } catch (e) { ctx.allowed = []; }
  }
  return ctx.allowed;
}
async function candlesOf(ctx, symbol, interval) {
  const k = `${symbol}:${interval}`;
  if (!ctx.candles.has(k)) {
    try { ctx.candles.set(k, await futuresRest.klines(`${symbol}USDT`, interval, guard.KLINE_LIMIT)); } catch (e) { ctx.candles.set(k, null); }
  }
  return ctx.candles.get(k);
}

// Entry size in coins: floored so notional <= sizeUsd.
function entrySize(sizeUsd, mark) {
  const cap = cents(sizeUsd);
  let size = Math.floor((sizeUsd / mark) * 1e8) / 1e8;
  while (size > 0 && notionalCents(size, mark) > cap) size = round8(size - 1e-8);
  return size;
}

// Closes the bot's position (stop, stop-all, kill switch). The intent row is the crash-recovery handle.
async function closeBotPosition(bot, why) {
  const pos = await Position.findById(bot.positionId).lean();
  if (!pos || pos.status !== 'open') { await observeClosed(bot, pos); return; }
  if (pos.lockOp) return;
  const d = await BotDecision.create({ botId: bot._id, userId: bot.userId, kind: 'risk', action: 'close', status: 'intent', positionId: pos._id, at: new Date(Date.now()), reason: { code: why } });
  await doClose(bot, pos, d);
}

// closeMarket + settle. Anything but "already closed" leaves the intent for recoverIntents to retry reduce-only.
async function doClose(bot, pos, d) {
  try {
    const r = await orders.closeMarket({ userId: String(bot.userId), positionId: pos._id, reason: 'bot' });
    await finish(d, { status: 'done', fillPrice: r.close.price, feeCents: r.close.feeCents, pnlCents: r.close.pnlCents });
    await release(bot._id, pos._id, r.position);
    return true;
  } catch (e) {
    if (e instanceof orders.ApiError) {
      if (e.code === 'NOT_OPEN') {
        const now = await Position.findById(pos._id).lean();
        await finish(d, { status: 'done', reason: { ...(d.reason || {}), detail: 'already_closed' } });
        await release(bot._id, pos._id, now);
        return true;
      }
      logger.warn(`bot ${bot._id}: close deferred to recovery (${e.code})`);
      return false;
    }
    throw e;
  }
}

// ---- intent recovery (start of every pass) ----
// -> true when the intent is resolved. Entries are never retried (the bar has passed); exits are retried reduce-only.
async function recoverOne(d) {
  const pos = d.positionId ? await Position.findById(d.positionId).lean() : null;
  if (d.action === 'close') {
    if (!pos || pos.status !== 'open') {
      await release(d.botId, d.positionId, pos);
      await finish(d, { status: 'done', fillPrice: pos && pos.exitPrice });
      return true;
    }
    if (pos.lockOp) return false;
    return doClose({ _id: d.botId, userId: d.userId }, pos, d);
  }
  if (!pos || pos.status === 'void') { await finish(d, { status: 'abandoned' }); return true; }
  if (pos.status === 'opening' || pos.lockOp) return false; // the risk engine's recoverAll is rolling it forward or back
  await Bot.updateOne({ _id: d.botId, positionId: null }, { $set: { positionId: d.positionId, entryBarTime: d.barTime == null ? null : d.barTime } });
  await finish(d, { status: 'done', fillPrice: pos.entryPrice, feeCents: cents(pos.fees || 0) });
  return true;
}

// -> Set of botIds with an unresolved intent: their state is uncertain, so the pass leaves them alone.
async function recoverIntents(now = Date.now()) {
  const busy = new Set();
  const rows = await BotDecision.find({ status: 'intent' }).limit(500).lean();
  for (const d of rows) {
    try {
      if (now - new Date(d.at).getTime() < INTENT_AGE_MS || !(await recoverOne(d))) busy.add(String(d.botId));
    } catch (e) {
      busy.add(String(d.botId));
      logger.error(`bot intent recovery failed ${d._id}: ${e.message}`);
    }
  }
  return busy;
}

// ---- one bot ----
const pauseWith = async (bot, stopReason, code) => {
  const r = await Bot.updateOne({ _id: bot._id, status: 'running' }, { $set: { status: 'paused', stopReason, updatedAt: new Date(Date.now()) } });
  if (r && (r.modifiedCount || r.nModified)) await risk(bot, { code });
};

async function tickBot(bot, ctx) {
  const now = Date.now();
  const iv = EVAL_SECONDS[bot.interval];
  const barTime = Math.floor(now / 1000 / iv) * iv - iv;
  if (bot.status !== 'running') {
    if (!bot.positionId || ctx.busy.has(String(bot._id))) return;
    if (bot.status === 'paused') { // a paused bot keeps its position under SL/TP: only book its close the day it happens
      const p = await Position.findById(bot.positionId).lean();
      if (p && p.status === 'opening') return;
      if (!p || p.status !== 'open') await observeClosed(bot, p, barTime);
      return;
    }
    await closeBotPosition(bot, bot.stopReason || bot.status); // stopped / killed with a position (stop, stop-all, kill switch)
    return;
  }
  // Integrity: what runs is exactly what was accepted.
  if (!bot.acceptedHash || botHash(bot) !== bot.acceptedHash) return pauseWith(bot, 'hash_mismatch', 'hash_mismatch');
  const parsed = parseSpec(bot.spec);
  if (!parsed.ok) return pauseWith(bot, 'invalid_spec', 'invalid_spec');
  if (ctx.busy.has(String(bot._id))) return;


  let pos = null;
  if (bot.positionId) {
    pos = await Position.findById(bot.positionId).lean();
    if (pos && pos.status === 'opening') return;
    if (!pos || pos.status !== 'open') {
      await observeClosed(bot, pos, barTime);
      return;
    }
  }

  // Kill switch, every pass, on a fresh mark. No mark with a position open: unrealized counts 0 (its SL still protects it),
  // but realized loss alone at or over the limit still kills.
  const key = guard.dayKey(now);
  let unreal = 0;
  if (pos) {
    const mark = await markOf(ctx, bot.symbol);
    if (mark != null) unreal = Math.floor(unrealized(pos, mark).pnl * 100);
  }
  if (guard.dailyLossHit(bot, bot.day, unreal, key)) {
    const r = await Bot.updateOne({ _id: bot._id, status: 'running' }, { $set: { status: 'killed', stopReason: 'daily_loss', updatedAt: new Date(Date.now()) } });
    if (r && (r.modifiedCount || r.nModified)) {
      await risk(bot, { code: 'DAILY_LOSS', realizedCents: bot.day && bot.day.key === key ? bot.day.realizedCents : 0, unrealizedCents: unreal });
      if (pos) await closeBotPosition({ ...bot, status: 'killed' }, 'daily_loss');
    }
    return;
  }

  // Bar gate: no network and no DB write unless a new closed bar is waiting.
  if (bot.lastBarTime >= barTime) return;
  const decideDone = async (fields) => { // rows that need no order are claimed and settled in one insert
    const d = await claim(bot, barTime, { status: 'done', ...fields });
    await advance(bot, barTime);
    return d;
  };
  if (now >= (barTime + iv) * 1000 + WINDOW_MS) { await decideDone({ action: 'missed', reason: { code: 'window' } }); return; }

  const rows = await candlesOf(ctx, bot.symbol, bot.interval);
  const source = rows && rows.source;
  if (rows && !CANDLE_SOURCES.includes(source)) { await decideDone({ action: 'skip', reason: { guard: 'candles_source', detail: source }, candlesSource: source }); return; }
  const closed = Array.isArray(rows) ? rows.filter((c) => c && c.time <= barTime) : [];
  if (!closed.length || closed[closed.length - 1].time !== barTime) return; // not there yet: retried until the window ends
  const candlesSource = source || 'binance-futures';

  const sig = signalAt(parsed.spec, closed, { interval: bot.interval, now });
  if (!sig || sig.barTime !== barTime) return;
  if (sig.warmingUp) { await decideDone({ action: 'skip', candlesSource, reason: { guard: 'WARMING_UP', need: sig.need, have: sig.have } }); return; }

  if (pos) {
    const exitHit = pos.side === 'long' ? sig.exitLong : sig.exitShort;
    const maxBars = parsed.spec.risk && parsed.spec.risk.maxBars;
    const held = bot.entryBarTime == null ? 0 : (barTime - bot.entryBarTime) / iv;
    const timeout = !!maxBars && held >= maxBars;
    if (!exitHit && !timeout) { await decideDone({ action: 'hold', candlesSource, reason: { signal: 'hold', conds: condsOf(sig, [pos.side === 'long' ? 'exitLong' : 'exitShort']) } }); return; }
    const reason = { signal: exitHit ? 'exit' : 'max_bars', conds: condsOf(sig, [pos.side === 'long' ? 'exitLong' : 'exitShort']) };
    if (stopping) return;
    const d = await claim(bot, barTime, { action: 'close', status: 'intent', positionId: pos._id, candlesSource, reason });
    if (!d) { await advance(bot, barTime); return; }
    await advance(bot, barTime);
    await doClose(bot, pos, d);
    return;
  }

  // flat
  if (stopping) return;
  const side = sig.entryLong ? 'long' : sig.entryShort ? 'short' : null;
  const groups = ['entryLong', 'entryShort'];
  if (!side) { await decideDone({ action: 'hold', candlesSource, reason: { signal: 'none', conds: condsOf(sig, groups) } }); return; }
  const action = `open_${side}`;
  const reason = { signal: action, conds: condsOf(sig, [side === 'long' ? 'entryLong' : 'entryShort']) };
  const mark = await markOf(ctx, bot.symbol); // fresh (<= MARK_TTL_MS): size and the cap check come from it
  if (mark == null) { await decideDone({ action: 'skip', candlesSource, reason: { ...reason, guard: 'NO_PRICE' } }); return; }
  const size = entrySize(bot.sizeUsd, mark);
  if (!(size > 0)) { await decideDone({ action: 'skip', candlesSource, reason: { ...reason, guard: 'MIN_NOTIONAL' } }); return; }
  const conflict = await Position.findOne({ userId: bot.userId, symbol: bot.symbol, side, status: { $in: ['opening', 'open'] } }).lean();
  const g = guard.check(bot, {
    allowed: await allowedOf(ctx), day: bot.day, dayKey: key, unrealizedCents: 0, conflict,
  }, { type: 'entry', notionalCents: Math.ceil(notionalCents(size, mark)) });
  if (!g.ok) { await decideDone({ action: 'skip', candlesSource, mark, reason: { ...reason, guard: g.code } }); return; }

  // Claim first, order second. A crash anywhere after this costs at most this one entry (abandoned), never a second one.
  const positionId = newId();
  const d = await claim(bot, barTime, { action, status: 'intent', positionId, mark, candlesSource, reason });
  if (!d) { await advance(bot, barTime); return; }
  await advance(bot, barTime);
  // The last conditional update before the order: still running with the accepted hash (a pause/stop/stop-all since the pass
  // snapshot misses) and under the trade cap. ponytail: the trade counter is not refunded when the order fails or is abandoned
  // (counts attempts), cap is conservative; a pause landing after this update and before openMarket is a few ms wide.
  if (!(await guard.claimTrade(Bot, bot, key))) { await finish(d, { action: 'skip', status: 'done', reason: { ...reason, guard: 'CLAIM_REFUSED' } }); return; }
  try {
    // stopPct/targetPct/maxNotionalCents: openMarket derives SL/TP from, and caps the size at, the actual fill price
    const r = await orders.openMarket({
      userId: String(bot.userId), symbol: bot.symbol, side, size, leverage: bot.leverage, positionId: String(positionId), botId: bot._id, noAdd: true,
      stopPct: parsed.spec.risk.stopPct, targetPct: parsed.spec.risk.targetPct || undefined, maxNotionalCents: cents(bot.sizeUsd),
    });
    // Same order as recoverOne: the bot owns the position BEFORE the intent settles, so a crash between the two leaves an
    // intent that recovery adopts, never an untracked open position.
    await Bot.updateOne({ _id: bot._id, positionId: null }, { $set: { positionId: r.position._id, entryBarTime: barTime } });
    await finish(d, { status: 'done', fillPrice: r.fill.price, feeCents: r.fill.feeCents });
  } catch (e) {
    // Rejected before any money moved: failed. Anything else (ledger error, crash) stays `intent` for recovery.
    if (e instanceof orders.ApiError && (e.status < 500 || e.code === 'NO_PRICE')) {
      await finish(d, { status: 'failed', reason: { ...reason, guard: e.code } });
      if (e.code === 'INSUFFICIENT_BALANCE') await pauseOnBalance(bot);
      return;
    }
    throw e;
  }
}

async function pauseOnBalance(bot) {
  const last = await BotDecision.find({ botId: bot._id, kind: 'tick', action: { $in: ['open_long', 'open_short'] } }).sort({ at: -1 }).limit(MAX_BALANCE_FAILS).lean();
  if (last.length === MAX_BALANCE_FAILS && last.every((x) => x.status === 'failed' && x.reason && x.reason.guard === 'INSUFFICIENT_BALANCE')) await pauseWith(bot, 'balance', 'INSUFFICIENT_BALANCE');
}

async function onError(bot, e) {
  logger.error(`bot ${bot._id} tick failed: ${e.message}`);
  try {
    const r = await Bot.findOneAndUpdate({ _id: bot._id }, { $inc: { errors: 1 } }, { new: true });
    if (r && r.errors >= MAX_ERRORS) await pauseWith(bot, 'errors', 'errors');
  } catch (e2) { logger.warn(`bot error count failed: ${e2.message}`); }
}

// closeOnly (BOTS_ENABLED=false): no bot runs and nothing enters, but a stopped/killed bot's position is still closed and a
// paused bot's SL/TP close still booked. Running bots are paused first (stopReason 'bots_disabled'): nothing watches them.
const WITH_POSITION = [{ status: { $in: ['stopped', 'killed', 'paused'] }, positionId: { $ne: null } }];
async function pass(closeOnly = false) {
  try {
    if (closeOnly) await Bot.updateMany({ status: 'running' }, { $set: { status: 'paused', stopReason: 'bots_disabled', updatedAt: new Date(Date.now()) } });
    const busy = await recoverIntents(Date.now());
    const ctx = { busy, marks: new Map(), candles: new Map(), allowed: null };
    const eligible = closeOnly ? WITH_POSITION : [{ status: 'running' }, ...WITH_POSITION];
    // _id cursor over ALL eligible bots, PAGE at a time: nothing is starved however many bots are stopped/paused with positions.
    let last = null;
    for (;;) {
      const bots = await Bot.find({ $or: eligible, ...(last ? { _id: { $gt: last } } : {}) }).sort({ _id: 1 }).limit(PAGE).lean();
      for (const bot of bots) {
        if (stopping) return;
        try {
          await tickBot(bot, ctx);
          if (bot.errors) await Bot.updateOne({ _id: bot._id, errors: { $gt: 0 } }, { $set: { errors: 0 } });
        } catch (e) {
          await onError(bot, e);
        }
      }
      if (bots.length < PAGE) break;
      last = bots[bots.length - 1]._id;
    }
  } catch (e) {
    logger.error(`botEngine pass failed: ${e.message}`);
  }
}

// One pass. -> the pass's promise (never rejects).
function runOnce() {
  if (!current) current = pass(!enabled()).finally(() => { current = null; });
  return current;
}

function start() {
  if (timer) return;
  stopping = false;
  if (!enabled()) logger.info('botEngine disabled (BOTS_ENABLED): close-only passes, no entries');
  else logger.info('botEngine started');
  timer = setInterval(() => { if (mongoose.connection.readyState === 1) runOnce(); }, EVERY_MS);
  if (timer.unref) timer.unref();
}

// -> promise that resolves when any in-flight pass has finished
function stop() {
  stopping = true;
  clearInterval(timer);
  timer = null;
  return current || Promise.resolve();
}

module.exports = { start, stop, runOnce, _test: { tickBot, recoverIntents, closeBotPosition, enabled, EVERY_MS, INTENT_AGE_MS, PAGE, resume: () => { stopping = false; } } };
