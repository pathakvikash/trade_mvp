const express = require('express');
const mongoose = require('mongoose');
const { createLimiter } = require('../middleware/rateLimit');
const logger = require('../config/logger');
const Bot = require('../models/Bot');
const BotDecision = require('../models/BotDecision');
const futuresRest = require('../services/futuresRest');
const tradeFill = require('../services/tradeFill');
const { parseSpec } = require('../services/strategy/schema');
const { evaluate } = require('../services/strategy/evaluate');
const { describe } = require('../services/strategy/describe');
const { hashOf, botHash } = require('../services/strategy/hash');
const Strategy = require('../models/Strategy');
const guard = require('../services/bot/riskGuard');
const performance = require('../services/bot/performance');

// Mounted as app.use('/api/bots', auth, botRoutes): req.user comes from the JWT only. Nothing here places an order:
// stop/stop-all only flip status (the engine, WP3, closes positions). Plan: context/bot-trading-plan.md section 4.
const router = express.Router();

const DISCLOSURE_VERSION = 1;
const DISCLOSURE = 'Paper money only. Fills are simulated at the mark price with no spread or depth, and funding is not charged, so real results would be worse. Backtests are fitted to the past. Forward results on few trades are noise. Not financial advice. Bots run only while the server is awake.';
const CREATE_KEYS = ['strategyId', 'spec', 'symbol', 'interval', 'sizeUsd', 'leverage', 'limits', 'name'];
const EDIT_KEYS = ['name', 'sizeUsd', 'leverage', 'limits'];

const writeLimit = createLimiter({ limit: 30, windowMs: 60 * 1000 }); // per user
const bad = (res, error, code) => res.status(400).json(code ? { error, code } : { error });
const conflict = (res, code) => res.status(409).json({ error: code, code });
const notFound = (res) => res.status(404).json({ error: 'not_found' });
const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { logger.error(`bot route failed: ${e.message}`); res.status(500).json({ error: 'internal_error' }); });
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) && mongoose.isValidObjectId(id);
const uid = (req) => req.user.userId;

// Default on in development/test, off in production until the owner sets BOTS_ENABLED=true.
const botsEnabled = () => {
  const v = String(process.env.BOTS_ENABLED || '').trim().toLowerCase();
  return v ? v === 'true' : process.env.NODE_ENV !== 'production';
};

// Allow-list = the overview's top-40 perps at call time, as base tickers.
const allowedSymbols = async () => (await futuresRest.overview()).map((r) => String(r.symbol).replace(/USDT$/, ''));

// Audit row for a status change; must never break the change itself.
const life = (bot, detail) => BotDecision.create({ botId: bot._id, userId: bot.userId, kind: 'lifecycle', reason: { detail, by: 'user' } })
  .catch((e) => logger.warn(`bot lifecycle log failed: ${e.message}`));

const view = (b) => ({ ...b, acceptHash: botHash(b), accepted: !!b.acceptedHash && b.acceptedHash === botHash(b) });
const worstCase = (b) => guard.worstCaseCents(Math.ceil(b.sizeUsd * 100), b.spec.risk && b.spec.risk.stopPct);

const load = async (req, res) => {
  if (!validId(req.params.id)) { notFound(res); return null; }
  const b = await Bot.findOne({ _id: req.params.id, userId: uid(req) }).lean();
  if (!b) notFound(res);
  return b;
};
const limited = (req, res) => writeLimit(uid(req), res); // true = already answered 429

router.get('/config', wrap(async (req, res) => {
  let symbols = [];
  try { symbols = await allowedSymbols(); } catch (e) { /* data outage: empty list, creation will 502 */ }
  res.json({ caps: guard.CAPS, defaults: guard.DEFAULTS, intervals: guard.INTERVALS, symbols, botsEnabled: botsEnabled(), disclosureVersion: DISCLOSURE_VERSION, disclosure: DISCLOSURE });
}));

router.get('/', wrap(async (req, res) => {
  const rows = await Bot.find({ userId: uid(req) }).sort({ createdAt: -1 }).lean();
  res.json(rows.map(view));
}));

// stop-all is registered before the /:id routes only for readability; POST has no clash with GET /:id.
router.post('/stop-all', wrap(async (req, res) => {
  if (limited(req, res)) return;
  const rows = await Bot.find({ userId: uid(req), status: { $in: ['running', 'paused'] } }).lean();
  // Flips status only; the engine closes the positions (also with BOTS_ENABLED=false, in its close-only passes).
  await Bot.updateMany({ userId: uid(req), status: { $in: ['running', 'paused'] } }, { $set: { status: 'stopped', stopReason: 'stop_all', updatedAt: new Date() } });
  await Promise.all(rows.map((b) => life(b, 'stop_all')));
  res.json({ stopped: rows.length });
}));

router.get('/:id', wrap(async (req, res) => {
  const b = await load(req, res);
  if (!b) return;
  const today = b.day && b.day.key === guard.dayKey() ? b.day : { trades: 0, realizedCents: 0 };
  res.json({ ...view(b), today });
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body;
  if (!isObj(b)) return bad(res, 'invalid body');
  if (Object.keys(b).some((k) => !CREATE_KEYS.includes(k))) return bad(res, 'unexpected field');
  if ((b.spec === undefined) === (b.strategyId === undefined)) return bad(res, 'send exactly one of spec or strategyId');
  if (limited(req, res)) return;
  let raw = b.spec;
  let strategyId = null;
  if (b.strategyId !== undefined) {
    if (!validId(b.strategyId)) return notFound(res);
    const row = await Strategy.findOne({ _id: b.strategyId, userId: uid(req) }).lean();
    if (!row) return notFound(res);
    raw = row.spec;
    strategyId = row._id;
  }
  const p = parseSpec(raw);
  if (!p.ok) return res.status(422).json({ error: 'invalid_spec', issues: p.issues });
  if (guard.warmupNeed(p.spec) > guard.MAX_CLOSED) return res.status(422).json({ error: 'WARMUP_TOO_LONG', code: 'WARMUP_TOO_LONG' });
  if (typeof b.symbol !== 'string' || !/^[A-Za-z0-9]{2,20}$/.test(b.symbol)) return bad(res, 'invalid symbol');
  const symbol = b.symbol.toUpperCase();
  const interval = b.interval === undefined ? p.spec.timeframe : b.interval;
  if (!guard.INTERVALS.includes(interval)) return bad(res, 'invalid interval');
  let name = p.spec.name;
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return bad(res, 'invalid name (1..60 chars)');
    name = b.name.trim();
  }
  let allowed;
  try { allowed = await allowedSymbols(); } catch (e) { return res.status(502).json({ error: 'market_data_unavailable' }); }
  if (!allowed.includes(symbol)) return bad(res, 'symbol not allowed', 'SYMBOL_NOT_ALLOWED');
  const v = guard.validateLimits(b, allowed, symbol);
  if (!v.ok) return bad(res, v.error);
  // ponytail: count-then-create can overshoot 5 by one under parallel requests, like the other caps.
  if (await Bot.countDocuments({ userId: uid(req) }) >= guard.CAPS.MAX_BOTS) return conflict(res, 'BOT_LIMIT');
  const doc = await Bot.create({ userId: uid(req), name: name.slice(0, 60), strategyId, spec: p.spec, specHash: hashOf(p.spec), symbol, interval, ...v.value });
  const bot = doc.toObject();
  await life(bot, 'create');
  let backtest = null;
  try { backtest = evaluate(p.spec, await futuresRest.klines(`${symbol}USDT`, interval, 500), { interval }); } catch (e) { /* shown as unavailable */ }
  res.status(201).json({ bot: view(bot), describe: describe(p.spec), acceptHash: botHash(bot), worstCaseLossCents: worstCase(bot), problem: guard.staticProblem(bot), backtest });
}));

router.put('/:id', wrap(async (req, res) => {
  const b = req.body;
  if (!isObj(b) || !Object.keys(b).length) return bad(res, 'invalid body');
  if (Object.keys(b).some((k) => !EDIT_KEYS.includes(k))) return bad(res, 'unexpected field');
  if (limited(req, res)) return;
  const bot = await load(req, res);
  if (!bot) return;
  if (!['proposed', 'paused'].includes(bot.status)) return conflict(res, 'BAD_STATE');
  const set = {};
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return bad(res, 'invalid name (1..60 chars)');
    set.name = b.name.trim();
  }
  let allowed;
  try { allowed = await allowedSymbols(); } catch (e) { return res.status(502).json({ error: 'market_data_unavailable' }); }
  if (b.limits !== undefined && !isObj(b.limits)) return bad(res, 'invalid limits');
  const v = guard.validateLimits({
    sizeUsd: b.sizeUsd === undefined ? bot.sizeUsd : b.sizeUsd,
    leverage: b.leverage === undefined ? bot.leverage : b.leverage,
    limits: { ...bot.limits, ...(b.limits || {}) },
  }, allowed, bot.symbol);
  if (!v.ok) return bad(res, v.error);
  // Any edit voids the acceptance; the claim pins status+rev so an edit racing an accept/start cannot slip through.
  const r = await Bot.findOneAndUpdate(
    // positionId null: a paused bot may still hold an open position; editing it would orphan the position.
    { _id: bot._id, userId: uid(req), rev: bot.rev, status: { $in: ['proposed', 'paused'] }, positionId: null },
    { $set: { ...set, ...v.value, status: 'proposed', acceptedHash: null, acceptedAt: null, disclosureVersion: null, updatedAt: new Date() }, $inc: { rev: 1 } },
    { new: true },
  ).lean();
  if (!r) return conflict(res, 'BAD_STATE');
  await life(r, 'edit');
  res.json(view(r));
}));

router.post('/:id/accept', wrap(async (req, res) => {
  const b = req.body;
  if (!isObj(b) || Object.keys(b).some((k) => !['acceptHash', 'ack'].includes(k))) return bad(res, 'invalid body');
  if (typeof b.acceptHash !== 'string') return bad(res, 'acceptHash is required');
  if (b.ack !== true) return bad(res, 'ack must be true');
  if (limited(req, res)) return;
  const bot = await load(req, res);
  if (!bot) return;
  if (bot.status !== 'proposed') return conflict(res, 'BAD_STATE');
  const hash = botHash(bot);
  if (b.acceptHash !== hash) return conflict(res, 'HASH_MISMATCH');
  const problem = guard.staticProblem(bot);
  if (problem) return res.status(422).json({ error: problem, code: problem });
  const r = await Bot.findOneAndUpdate(
    { _id: bot._id, userId: uid(req), status: 'proposed', rev: bot.rev },
    { $set: { status: 'paused', acceptedHash: hash, acceptedAt: new Date(), disclosureVersion: DISCLOSURE_VERSION, updatedAt: new Date() } },
    { new: true },
  ).lean();
  if (!r) return conflict(res, 'BAD_STATE');
  await life(r, 'accept');
  res.json(view(r));
}));

router.post('/:id/decline', wrap(async (req, res) => {
  if (limited(req, res)) return;
  const bot = await load(req, res);
  if (!bot) return;
  const r = await Bot.findOneAndUpdate({ _id: bot._id, userId: uid(req), status: { $in: ['proposed', 'paused'] }, positionId: null }, { $set: { status: 'declined', acceptedHash: null, updatedAt: new Date() } }, { new: true }).lean();
  if (!r) return conflict(res, 'BAD_STATE');
  await life(r, 'decline');
  res.json(view(r));
}));

router.post('/:id/start', wrap(async (req, res) => {
  if (limited(req, res)) return;
  if (!botsEnabled()) return res.status(403).json({ error: 'BOTS_DISABLED', code: 'BOTS_DISABLED' });
  const bot = await load(req, res);
  if (!bot) return;
  // A start needs an acceptance of exactly what is stored now: recomputed hash, not a flag.
  if (bot.status !== 'paused' || !bot.acceptedHash || bot.acceptedHash !== botHash(bot) || guard.staticProblem(bot)) return conflict(res, 'NOT_ACCEPTED');
  if (await Bot.countDocuments({ status: 'running' }) >= guard.CAPS.MAX_RUNNING_PROCESS) return conflict(res, 'RUNNING_LIMIT');
  const now = new Date();
  const r = await Bot.findOneAndUpdate(
    { _id: bot._id, userId: uid(req), status: 'paused', acceptedHash: bot.acceptedHash, rev: bot.rev },
    { $set: { status: 'running', runningSince: now, stopReason: null, errors: 0, updatedAt: now } },
    { new: true },
  ).lean();
  if (!r) return conflict(res, 'NOT_ACCEPTED');
  // Cap race: flip first, then count. If this user now has more than MAX_RUNNING, undo our own flip. Two racers may both
  // see the overshoot and both revert (safe side: the user just retries); the cap is never exceeded for good.
  if (await Bot.countDocuments({ userId: uid(req), status: 'running' }) > guard.CAPS.MAX_RUNNING) {
    await Bot.updateOne({ _id: bot._id, status: 'running' }, { $set: { status: 'paused', updatedAt: new Date() } });
    return conflict(res, 'RUNNING_LIMIT');
  }
  // startedAt / startMark only now that the start has stuck.
  if (!bot.startedAt) { await Bot.updateOne({ _id: bot._id, startedAt: null }, { $set: { startedAt: now } }); r.startedAt = now; }
  if (r.startMark == null) {
    try {
      const f = await tradeFill.fillPrice(`${bot.symbol}USDT`);
      if (f && f.price > 0) { await Bot.updateOne({ _id: bot._id, startMark: null }, { $set: { startMark: f.price } }); r.startMark = f.price; }
    } catch (e) { /* no mark now: the engine records it */ }
  }
  await life(r, 'start');
  res.json(view(r));
}));

router.post('/:id/pause', wrap(async (req, res) => {
  if (limited(req, res)) return;
  const bot = await load(req, res);
  if (!bot) return;
  const r = await Bot.findOneAndUpdate({ _id: bot._id, userId: uid(req), status: 'running' }, { $set: { status: 'paused', updatedAt: new Date() } }, { new: true }).lean();
  if (!r) return conflict(res, 'BAD_STATE');
  await life(r, 'pause');
  res.json(view(r));
}));

router.post('/:id/stop', wrap(async (req, res) => {
  if (limited(req, res)) return;
  const bot = await load(req, res);
  if (!bot) return;
  // Status only; the engine closes the open position (protected by its SL/TP meanwhile).
  const r = await Bot.findOneAndUpdate({ _id: bot._id, userId: uid(req), status: { $in: ['running', 'paused'] } }, { $set: { status: 'stopped', stopReason: 'user', updatedAt: new Date() } }, { new: true }).lean();
  if (!r) return conflict(res, 'BAD_STATE');
  await life(r, 'stop');
  res.json(view(r));
}));

router.get('/:id/decisions', wrap(async (req, res) => {
  const bot = await load(req, res);
  if (!bot) return;
  const { before, kind } = req.query;
  let limit = 50;
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return bad(res, 'invalid limit (1..100)');
  }
  const q = { botId: bot._id, userId: uid(req) };
  if (kind !== undefined) {
    if (!['tick', 'risk', 'observed', 'lifecycle'].includes(kind)) return bad(res, 'invalid kind');
    q.kind = kind;
  }
  if (before !== undefined) {
    const d = new Date(/^\d+$/.test(String(before)) ? Number(before) : String(before));
    if (Number.isNaN(d.getTime())) return bad(res, 'invalid before');
    q.at = { $lt: d };
  }
  res.json(await BotDecision.find(q).sort({ at: -1 }).limit(limit).lean());
}));

router.get('/:id/performance', wrap(async (req, res) => {
  const bot = await load(req, res);
  if (!bot) return;
  res.json(await performance.performanceFor(bot));
}));

router.delete('/:id', wrap(async (req, res) => {
  if (limited(req, res)) return;
  const bot = await load(req, res);
  if (!bot) return;
  const r = await Bot.deleteOne({ _id: bot._id, userId: uid(req), status: { $ne: 'running' }, positionId: null });
  if (!r.deletedCount) return conflict(res, 'BAD_STATE');
  res.json({ ok: true });
}));

module.exports = router;
module.exports.botsEnabled = botsEnabled;
