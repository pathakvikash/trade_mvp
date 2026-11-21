// Alert evaluator: every 5s checks active alerts against live mark price / funding / sampled liquidations.
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const config = require('../config/config');
const logger = require('../config/logger');
const Alert = require('../models/Alert');
const AlertEvent = require('../models/AlertEvent');
const futures = require('./futuresService');
const { accountOk } = require('../middleware/auth');

const EVAL_MS = 5000;
const REFRESH_MS = 60000;
const MARK_MAX_AGE_MS = 30000; // older mark data is treated as missing
const LIQ_WINDOW_MS = 5 * 60 * 1000;
const MIN_REFIRE_MS = 60000; // hard floor between fires of one alert, independent of cooldown resets

// Pure trigger decision. observed: number | null.
function shouldTrigger(alert, observed, nowMs, lastFiredMs = 0) {
    if (!alert || !alert.active) return false;
    if (lastFiredMs && nowMs - lastFiredMs < MIN_REFIRE_MS) return false;
    if (typeof observed !== 'number' || !Number.isFinite(observed)) return false;
    if (alert.lastTriggeredAt && nowMs - new Date(alert.lastTriggeredAt).getTime() < alert.cooldownMin * 60000) return false;
    return alert.op === 'above' ? observed > alert.value : alert.op === 'below' ? observed < alert.value : false;
}

function observe(alert, nowMs) {
    if (alert.metric === 'liq_usd_5m') {
        return futures.getLiquidations(alert.symbol).events
            .reduce((sum, e) => (nowMs - e.ts <= LIQ_WINDOW_MS ? sum + e.usd : sum), 0);
    }
    const m = futures.getMark(alert.symbol);
    if (!m || nowMs - m.ts > MARK_MAX_AGE_MS) return null;
    return alert.metric === 'price' ? m.markPrice : m.fundingRate * 100; // funding as PERCENT
}

let ns = null;
let evalTimer = null;
let refreshTimer = null;
let active = []; // cached active alerts (lean docs)
const fired = new Map(); // alertId -> last trigger ms (local; also the 60s floor, so never cleared by a cooldown reset)
const resets = new Map(); // alertId -> ms of last cooldown reset; triggers at or before it no longer count toward the cooldown
const held = new Set(); // symbols currently held on futuresService

// liq_usd_5m reads the all-market buffer; only price/funding need the symbol's markPrice stream
const needsHold = (a) => a.metric !== 'liq_usd_5m';

// ponytail: reconcile every cycle against the cached list; holds are released/acquired one symbol at a time.
function reconcile() {
    const want = new Set(active.filter(needsHold).map((a) => a.symbol));
    for (const s of held) if (!want.has(s)) { futures.release(s); held.delete(s); }
    for (const s of want) if (!held.has(s) && futures.hold(s)) held.add(s);
}

// Read-only status for GET /api/alerts: 'no_data' when the alert needs a mark and has none (hold refused or stale).
function statusOf(alert, nowMs = Date.now()) {
    if (!needsHold(alert) || !alert.active) return 'watching';
    const m = held.has(alert.symbol) && futures.getMark(alert.symbol);
    return m && nowMs - m.ts <= MARK_MAX_AGE_MS ? 'watching' : 'no_data';
}

let seq = 0;
async function refresh() {
    if (mongoose.connection.readyState !== 1) return;
    const my = ++seq; // concurrent refreshes can resolve out of order; only the newest may write
    try {
        const rows = await Alert.find({ active: true }).lean();
        if (my !== seq) return;
        active = rows;
        const ids = new Set(rows.map((r) => String(r._id)));
        // keep a paused alert's last-fire time for the floor window, or pause→resume would bypass it
        for (const [id, t] of fired) if (!ids.has(id) && Date.now() - t >= MIN_REFIRE_MS) fired.delete(id);
        for (const id of resets.keys()) if (!ids.has(id)) resets.delete(id);
        reconcile();
    } catch (e) {
        logger.error(`alertService refresh failed: ${e.message}`);
    }
}

async function evaluate(now = Date.now()) {
    reconcile();
    for (const a of active) {
        const id = String(a._id);
        const lastFired = fired.get(id) || 0;
        const last = Math.max(lastFired, a.lastTriggeredAt ? new Date(a.lastTriggeredAt).getTime() : 0);
        const alert = { ...a, lastTriggeredAt: last > (resets.get(id) || 0) ? last : null };
        const observed = observe(alert, now);
        if (!shouldTrigger(alert, observed, now, lastFired)) continue;
        fired.set(id, now);
        const payload = { alertId: id, symbol: a.symbol, metric: a.metric, op: a.op, value: a.value, observed, note: a.note, ts: now };
        if (ns) ns.to(`user:${a.userId}`).emit('alert:triggered', payload);
        try {
            await Promise.all([
                Alert.updateOne({ _id: a._id }, { lastTriggeredAt: new Date(now) }),
                AlertEvent.create({ userId: a.userId, alertId: a._id, symbol: a.symbol, metric: a.metric, op: a.op, value: a.value, observed, ts: new Date(now) }),
            ]);
        } catch (e) {
            logger.error(`alertService persist failed: ${e.message}`);
        }
    }
}

async function authSocket(socket, next) {
    try {
        const decoded = jwt.verify(socket.handshake.auth && socket.handshake.auth.token, config.jwt.secret, { algorithms: ['HS256'] });
        if (!decoded.userId) throw new Error('no userId');
        if (!(await accountOk(decoded))) throw new Error('revoked');
        socket.userId = String(decoded.userId);
        next();
    } catch (e) {
        next(new Error('unauthorized'));
    }
}

function start(io) {
    ns = io.of('/alerts');
    ns.use(authSocket);
    ns.on('connection', (socket) => socket.join(`user:${socket.userId}`));
    if (mongoose.connection.readyState === 1) refresh();
    else mongoose.connection.once('connected', refresh);
    refreshTimer = setInterval(refresh, REFRESH_MS);
    evalTimer = setInterval(() => evaluate().catch((e) => logger.error(`alertService evaluate failed: ${e.message}`)), EVAL_MS);
    [refreshTimer, evalTimer].forEach((t) => t.unref && t.unref());
    logger.info('alertService started');
}

// Drop every live socket of a user (password change, sign out everywhere, account deletion): the socket auth only runs at
// connect time, so without this an existing connection would outlive its token. Best effort.
function kick(userId) {
    if (ns) ns.in(`user:${userId}`).disconnectSockets(true);
}

function stop() {
    clearInterval(evalTimer);
    clearInterval(refreshTimer);
    for (const s of held) futures.release(s);
    held.clear();
    active = [];
    ns = null;
}

module.exports = { start, stop, kick, refresh, shouldTrigger, statusOf, resetCooldown: (id) => resets.set(String(id), Date.now()), _test: { getActive: () => active, evaluate, reconcile, observe, authSocket, setActive: (v) => { active = v; }, held, fired, resets } };
