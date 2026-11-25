// /api/ai/agent/*: single-shot analyst chat + conversation history. Mounted by routes/aiRoutes.js AFTER its auth
// middleware, so req.user comes from the JWT only. The model has no actions; its reply is inert data.
const express = require('express');
const mongoose = require('mongoose');
const ai = require('../services/aiService');
const agent = require('../services/ai/agentService');
const { settingsFor, limited, dailyLimited } = require('../services/ai/aiAccess');
const AiConversation = require('../models/AiConversation');
const futuresRest = require('../services/futuresRest');
const { isValidSymbol } = require('../services/futuresUtils');
const instruments = require('../services/marketData/instruments');
const yahoo = require('../services/marketData/providers/yahoo');

const router = express.Router();

const MAX_CONVERSATIONS = 10;
const MAX_MESSAGES = 40;
const PAGES = ['trade', 'derivatives', 'liquidation', 'markets', 'dashboard'];
const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);
const bad = (res, error) => res.status(400).json({ error });
const notFound = (res) => res.status(404).json({ error: 'not_found' });
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) && mongoose.isValidObjectId(id);
const uid = (req) => req.user.userId;
const wrap = (fn) => (req, res) => fn(req, res).catch(() => res.status(500).json({ error: 'internal_error' }));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fail = (res, err) => { if (err && err.retryAfter) res.set('Retry-After', String(err.retryAfter)); const m = ai.mapError(err); res.status(m.status).json(m.body); };

// Curated markets go through yahoo with the static instrument list (the symbol is validated against it first).
const deps = () => ({
  instruments: {
    quotes: () => yahoo.quotes(),
    klines: (sym, iv, n) => { const inst = instruments.find(sym); if (!inst) throw new Error('unknown instrument'); return yahoo.klines(inst, iv, n); },
  },
});

const summary = (c) => ({ id: String(c._id), scope: c.scope, title: c.title, updatedAt: c.updatedAt, messageCount: (c.messages || []).length });

router.post('/chat', wrap(async (req, res) => {
  const b = req.body;
  if (!isObj(b)) return bad(res, 'invalid body');
  if (Object.keys(b).some((k) => !['conversationId', 'context', 'message', 'wantStrategy'].includes(k))) return bad(res, 'unexpected field');
  const c = b.context;
  if (!isObj(c) || !['perp', 'instrument'].includes(c.kind)) return bad(res, 'invalid kind');
  if (typeof c.symbol !== 'string') return bad(res, 'invalid symbol');
  if (!PAGES.includes(c.page)) return bad(res, 'invalid page');
  if (c.interval !== undefined && !(typeof c.interval === 'string' && /^\d{1,2}[mhdw]$/.test(c.interval))) return bad(res, 'invalid interval');
  const message = typeof b.message === 'string' ? b.message.trim() : '';
  if (!message || message.length > 1000) return bad(res, 'message must be 1..1000 chars');
  if (b.wantStrategy !== undefined && typeof b.wantStrategy !== 'boolean') return bad(res, 'invalid wantStrategy');
  if (b.conversationId !== undefined && !validId(b.conversationId)) return notFound(res);

  const symbol = c.symbol.toUpperCase();
  if (c.kind === 'perp') {
    if (!isValidSymbol(symbol)) return bad(res, 'invalid symbol');
    if (!(await futuresRest.isKnownSymbol(symbol))) return res.status(404).json({ error: `No perpetual futures market for ${symbol}` });
  } else if (!instruments.find(symbol)) return res.status(404).json({ error: `Unknown market ${symbol.slice(0, 20)}` });

  let conv = null;
  if (b.conversationId !== undefined) {
    conv = await AiConversation.findOne({ _id: b.conversationId, userId: uid(req) }).lean();
    if (!conv) return notFound(res); // foreign and unknown ids look the same
  }
  const settings = await settingsFor(uid(req));
  if (limited(req, res)) return; // 10/min per user, shared with brief/ask/alerts-parse; after validation so bad input is free
  if (dailyLimited(req, res, settings)) return; // 60/day, default provider only

  let out;
  try {
    out = await agent.chat({ userId: uid(req), settings, kind: c.kind, symbol, page: c.page, interval: c.interval, message, wantStrategy: b.wantStrategy === true, history: conv ? conv.messages : [], deps: deps() });
  } catch (err) { return fail(res, err); }

  const now = new Date();
  const r = out.reply;
  const msgs = [
    { role: 'user', text: message, at: now },
    { role: 'assistant', text: r.text || '(no answer)', ...(r.strategy && { strategy: { spec: r.strategy.spec, describe: r.strategy.describe } }), at: now },
  ];
  let id;
  if (conv) {
    id = String(conv._id);
    await AiConversation.findOneAndUpdate({ _id: conv._id, userId: uid(req) }, { $push: { messages: { $each: msgs, $slice: -MAX_MESSAGES } }, $set: { updatedAt: now } });
  } else {
    const row = await AiConversation.create({ userId: uid(req), scope: `${c.kind}:${symbol}`, title: clip(message, 60), messages: msgs, updatedAt: now });
    id = String(row._id);
    // ponytail: count-then-delete is not atomic; parallel first messages can leave 11 for a moment, the next one trims.
    const n = await AiConversation.countDocuments({ userId: uid(req) });
    if (n > MAX_CONVERSATIONS) {
      const old = await AiConversation.find({ userId: uid(req) }).sort({ updatedAt: 1 }).limit(n - MAX_CONVERSATIONS).select('_id').lean();
      await AiConversation.deleteMany({ userId: uid(req), _id: { $in: old.map((o) => o._id) } });
    }
  }
  res.json({ conversationId: id, reply: r, disclaimer: out.disclaimer });
}));

router.get('/conversations', wrap(async (req, res) => {
  const rows = await AiConversation.find({ userId: uid(req) }).sort({ updatedAt: -1 }).lean();
  res.json({ conversations: rows.map(summary) });
}));

router.get('/conversations/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return notFound(res);
  const c = await AiConversation.findOne({ _id: req.params.id, userId: uid(req) }).lean();
  if (!c) return notFound(res);
  res.json({ ...summary(c), messages: c.messages });
}));

router.delete('/conversations/:id', wrap(async (req, res) => {
  if (!validId(req.params.id)) return notFound(res);
  const r = await AiConversation.deleteOne({ _id: req.params.id, userId: uid(req) });
  if (!r.deletedCount) return notFound(res);
  res.json({ ok: true });
}));

router.delete('/conversations', wrap(async (req, res) => {
  const r = await AiConversation.deleteMany({ userId: uid(req) });
  res.json({ ok: true, deleted: r.deletedCount || 0 });
}));

module.exports = router;
