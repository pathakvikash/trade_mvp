const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const { limitBy } = require('../middleware/rateLimit');
const Alert = require('../models/Alert');
const AlertEvent = require('../models/AlertEvent');
const alertService = require('../services/alertService');
const { isValidSymbol } = require('../services/futuresUtils');
const { isKnownSymbol } = require('../services/futuresRest');

const router = express.Router();
router.use(auth);
router.use((req, res, next) => (req.user && req.user.userId ? next() : res.status(401).json({ success: false, message: 'Invalid token' })));
router.use(limitBy({ limit: 60, windowMs: 60 * 1000 }, (req) => req.user.userId)); // alerts CRUD: 60/min per user

const MAX_ALERTS = 20;
const MAX_SYMBOLS = 5;
const METRICS = ['price', 'funding', 'liq_usd_5m'];
const OPS = ['above', 'below'];
const bad = (res, error) => res.status(400).json({ error });
const isObj = (b) => b && typeof b === 'object' && !Array.isArray(b);

// Validates the fields present in `b`; returns { error } or { doc } (only whitelisted keys).
function parse(b, keys) {
    if (!isObj(b)) return { error: 'invalid body' };
    const extra = Object.keys(b).filter((k) => !keys.includes(k));
    if (extra.length) return { error: `unexpected field: ${extra[0]}` };
    const doc = {};
    if ('symbol' in b) { if (!isValidSymbol(b.symbol)) return { error: 'invalid symbol' }; doc.symbol = b.symbol; }
    if ('metric' in b) { if (!METRICS.includes(b.metric)) return { error: 'invalid metric' }; doc.metric = b.metric; }
    if ('op' in b) { if (!OPS.includes(b.op)) return { error: 'invalid op' }; doc.op = b.op; }
    if ('value' in b) { if (typeof b.value !== 'number' || !Number.isFinite(b.value)) return { error: 'invalid value' }; doc.value = b.value; }
    if ('note' in b) { if (typeof b.note !== 'string' || b.note.length > 140) return { error: 'invalid note (max 140 chars)' }; doc.note = b.note.trim(); }
    if ('cooldownMin' in b) { if (!Number.isInteger(b.cooldownMin) || b.cooldownMin < 1 || b.cooldownMin > 1440) return { error: 'invalid cooldownMin (1..1440)' }; doc.cooldownMin = b.cooldownMin; }
    if ('active' in b) { if (typeof b.active !== 'boolean') return { error: 'invalid active' }; doc.active = b.active; }
    return { doc };
}

const wrap = (fn) => (req, res) => fn(req, res).catch(() => res.status(500).json({ error: 'internal_error' }));
const validId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id) && mongoose.isValidObjectId(id);

router.get('/', wrap(async (req, res) => {
    const rows = await Alert.find({ userId: req.user.userId }).sort({ createdAt: -1 }).lean();
    const now = Date.now();
    res.json(rows.map((a) => ({ ...a, status: alertService.statusOf(a, now) })));
}));

// declared before /:id routes
router.get('/events', wrap(async (req, res) => {
    const n = parseInt(req.query.limit, 10);
    const limit = Math.min(200, Math.max(1, n > 0 ? n : 50));
    const rows = await AlertEvent.find({ userId: req.user.userId }).sort({ ts: -1 }).limit(limit).lean();
    res.json(rows.map((e) => ({ ...e, ts: new Date(e.ts).getTime() }))); // ms, same as the socket event
}));

router.post('/', wrap(async (req, res) => {
    const { error, doc } = parse(req.body, ['symbol', 'metric', 'op', 'value', 'note', 'cooldownMin']);
    if (error) return bad(res, error);
    for (const k of ['symbol', 'metric', 'op', 'value']) if (!(k in doc)) return bad(res, `${k} is required`);
    if (!(await isKnownSymbol(doc.symbol))) return bad(res, 'unknown symbol');
    // ponytail: count-then-create is not atomic; two parallel creates can overshoot 20 by one.
    if (await Alert.countDocuments({ userId: req.user.userId }) >= MAX_ALERTS) return res.status(409).json({ error: `max ${MAX_ALERTS} alerts` });
    const syms = await Alert.distinct('symbol', { userId: req.user.userId });
    if (!syms.includes(doc.symbol) && syms.length >= MAX_SYMBOLS) return res.status(409).json({ error: `max ${MAX_SYMBOLS} symbols` });
    const alert = await Alert.create({ ...doc, userId: req.user.userId });
    await alertService.refresh();
    res.status(201).json(alert.toObject());
}));

router.patch('/:id', wrap(async (req, res) => {
    if (!validId(req.params.id)) return bad(res, 'invalid id');
    const { error, doc } = parse(req.body, ['active', 'value', 'note', 'cooldownMin']);
    if (error) return bad(res, error);
    if (!Object.keys(doc).length) return bad(res, 'nothing to update');
    // a CHANGED threshold starts with a clean cooldown (DB copy here, in-memory copy below); same value keeps it
    let changed = false;
    if ('value' in doc) {
        const cur = await Alert.findOne({ _id: req.params.id, userId: req.user.userId }).select('value').lean();
        if (!cur) return res.status(404).json({ error: 'not_found' });
        changed = cur.value !== doc.value;
    }
    const set = changed ? { ...doc, lastTriggeredAt: null } : doc;
    const alert = await Alert.findOneAndUpdate({ _id: req.params.id, userId: req.user.userId }, { $set: set }, { new: true, runValidators: true }).lean();
    if (!alert) return res.status(404).json({ error: 'not_found' });
    if (changed) alertService.resetCooldown(alert._id);
    await alertService.refresh();
    res.json(alert);
}));

router.delete('/:id', wrap(async (req, res) => {
    if (!validId(req.params.id)) return bad(res, 'invalid id');
    const r = await Alert.deleteOne({ _id: req.params.id, userId: req.user.userId });
    if (!r.deletedCount) return res.status(404).json({ error: 'not_found' });
    await alertService.refresh();
    res.json({ ok: true });
}));

module.exports = router;
