const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const { createLimiter } = require('../middleware/rateLimit');
const Strategy = require('../models/Strategy');
const futuresRest = require('../services/futuresRest');
const { isValidSymbol, INTERVALS } = require('../services/futuresUtils');
const instruments = require('../services/marketData/instruments');
const yahoo = require('../services/marketData/providers/yahoo');
const { parseSpec } = require('../services/strategy/schema');
const { evaluate } = require('../services/strategy/evaluate');
const { describe } = require('../services/strategy/describe');

// Mounted as app.use('/api/strategies', auth, strategyRoutes): req.user comes from the JWT only.
const router = express.Router();

const MAX_STRATEGIES = 20;
const validateLimit = createLimiter({ limit: 60, windowMs: 60 * 1000 }); // per user
const evaluateLimit = createLimiter({ limit: 30, windowMs: 60 * 1000 }); // per user
const bad = (res, error) => res.status(400).json({ error });
const notFound = (res) => res.status(404).json({ error: 'not_found' });
const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);
const wrap = (fn) => (req, res) => fn(req, res).catch(() => res.status(500).json({ error: 'internal_error' }));
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) && mongoose.isValidObjectId(id);
const uid = (req) => req.user.userId;
// Error bodies carry paths and short messages only, never the submitted spec.
const invalid = (res, issues) => res.status(422).json({ error: 'invalid_spec', issues });

const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const hashOf = (spec) => crypto.createHash('sha256').update(JSON.stringify(canon(spec))).digest('hex');

// Shared body checks for create/update: whitelisted keys, strict types. Returns { error } | { doc } (doc.spec already parsed).
// An invalid spec returns { issues } instead.
function parseBody(b, keys) {
  if (!isObj(b)) return { error: 'invalid body' };
  const extra = Object.keys(b).filter((k) => !keys.includes(k));
  if (extra.length) return { error: 'unexpected field' };
  const doc = {};
  if ('name' in b) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) return { error: 'invalid name (1..60 chars)' }; doc.name = b.name.trim(); }
  if ('symbol' in b) { const sym = String(b.symbol).toUpperCase(); if (typeof b.symbol !== 'string' || (!isValidSymbol(sym) && !instruments.find(sym))) return { error: 'invalid symbol' }; doc.symbol = sym; }
  if ('origin' in b) { if (!['ai', 'user'].includes(b.origin)) return { error: 'invalid origin' }; doc.origin = b.origin; }
  if ('spec' in b) {
    const p = parseSpec(b.spec);
    if (!p.ok) return { issues: p.issues };
    doc.spec = p.spec;
    doc.specHash = hashOf(p.spec);
    if (!doc.name && !('name' in b)) doc.name = p.spec.name;
  }
  return { doc };
}

router.post('/validate', wrap(async (req, res) => {
  if (validateLimit(uid(req), res)) return;
  if (!isObj(req.body) || !('spec' in req.body)) return bad(res, 'spec is required');
  const p = parseSpec(req.body.spec);
  if (!p.ok) return invalid(res, p.issues);
  res.json({ spec: p.spec, describe: describe(p.spec) });
}));

router.post('/evaluate', wrap(async (req, res) => {
  const b = req.body;
  if (!isObj(b)) return bad(res, 'invalid body');
  // candles (or anything else) supplied by the client are rejected outright: the server fetches its own.
  if (Object.keys(b).some((k) => !['spec', 'strategyId', 'kind', 'symbol', 'interval', 'limit', 'costs'].includes(k))) return bad(res, 'unexpected field');
  if (!['perp', 'instrument'].includes(b.kind)) return bad(res, 'invalid kind');
  if (typeof b.symbol !== 'string' || (b.interval !== undefined && typeof b.interval !== 'string')) return bad(res, 'symbol is required');
  const limit = b.limit === undefined ? 500 : b.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return bad(res, 'invalid limit (1..1000)');
  let slippagePct;
  if (b.costs !== undefined) {
    if (!isObj(b.costs) || Object.keys(b.costs).some((k) => k !== 'slippagePct')) return bad(res, 'invalid costs');
    slippagePct = b.costs.slippagePct;
    if (slippagePct !== undefined && (typeof slippagePct !== 'number' || !(slippagePct >= 0 && slippagePct <= 1))) return bad(res, 'invalid slippagePct (0..1)');
  }
  if ((b.spec === undefined) === (b.strategyId === undefined)) return bad(res, 'send exactly one of spec or strategyId');
  if (evaluateLimit(uid(req), res)) return;

  let rawSpec = b.spec;
  if (b.strategyId !== undefined) {
    if (!validId(b.strategyId)) return notFound(res);
    const row = await Strategy.findOne({ _id: b.strategyId, userId: uid(req) }).lean();
    if (!row) return notFound(res);
    rawSpec = row.spec;
  }
  const p = parseSpec(rawSpec); // fail fast before any upstream fetch; evaluate() re-validates anyway
  if (!p.ok) return invalid(res, p.issues);

  const symbol = b.symbol.toUpperCase();
  // The spec decides its own candle interval: a client interval that disagrees (or is junk) is ignored, never used.
  const interval = p.spec.timeframe;
  let rows, fallback;
  try {
    if (b.kind === 'perp') {
      if (!isValidSymbol(symbol)) return bad(res, 'invalid symbol');
      if (!INTERVALS.includes(interval)) return bad(res, 'invalid interval');
      if (!(await futuresRest.isKnownSymbol(symbol))) return notFound(res);
      rows = await futuresRest.klines(symbol, interval, limit);
      fallback = 'binance-futures';
    } else {
      const inst = instruments.find(symbol);
      if (!inst) return notFound(res);
      if (!Object.prototype.hasOwnProperty.call(yahoo.INTERVALS, interval)) return bad(res, 'invalid interval');
      rows = (await yahoo.klines(inst, interval, limit)).candles;
      fallback = 'yahoo';
    }
  } catch (e) {
    return res.status(502).json({ error: 'market_data_unavailable' });
  }
  const candlesSource = (rows && rows.source) || fallback;
  try {
    const out = evaluate(p.spec, rows, { slippagePct });
    res.json({ ...out, candlesSource });
  } catch (e) {
    if (e.message === 'invalid_spec') return invalid(res, e.issues);
    throw e;
  }
}));

router.get('/', wrap(async (req, res) => {
  res.json(await Strategy.find({ userId: uid(req) }).sort({ createdAt: -1 }).lean());
}));

router.get('/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return notFound(res);
  const row = await Strategy.findOne({ _id: req.params.id, userId: uid(req) }).lean();
  if (!row) return notFound(res);
  res.json(row);
}));

router.post('/', wrap(async (req, res) => {
  const { error, issues, doc } = parseBody(req.body, ['name', 'spec', 'symbol', 'origin']);
  if (error) return bad(res, error);
  if (issues) return invalid(res, issues);
  if (!doc.spec) return bad(res, 'spec is required');
  // ponytail: count-then-create is not atomic; two parallel creates can overshoot 20 by one.
  if (await Strategy.countDocuments({ userId: uid(req) }) >= MAX_STRATEGIES) return res.status(409).json({ error: 'STRATEGY_LIMIT' });
  const row = await Strategy.create({ ...doc, userId: uid(req) });
  res.status(201).json(row.toObject());
}));

router.put('/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return notFound(res);
  const { error, issues, doc } = parseBody(req.body, ['name', 'spec', 'symbol']);
  if (error) return bad(res, error);
  if (issues) return invalid(res, issues);
  if (!Object.keys(doc).length) return bad(res, 'nothing to update');
  const row = await Strategy.findOneAndUpdate({ _id: req.params.id, userId: uid(req) }, { $set: { ...doc, updatedAt: new Date() } }, { new: true, runValidators: true }).lean();
  if (!row) return notFound(res);
  res.json(row);
}));

router.delete('/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return notFound(res);
  const r = await Strategy.deleteOne({ _id: req.params.id, userId: uid(req) });
  if (!r.deletedCount) return notFound(res);
  res.json({ ok: true });
}));

module.exports = router;
