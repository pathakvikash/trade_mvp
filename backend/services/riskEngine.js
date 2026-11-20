// Futures risk engine: every second, per symbol with a fresh server mark, liquidates / stops out / takes profit on open
// positions and fills crossed limit ENTRY orders. Every money or state change is ONE futuresLedger.run (the lock inside it
// is the claim, so a user close racing a trigger settles once); the engine never writes money itself.
// Spec: docs/phase2-leverage.md §3. Pattern: orderMatcher (one in-flight pass, stop() drains).
const mongoose = require('mongoose');
const Position = require('../models/Position');
const FuturesOrder = require('../models/FuturesOrder');
const logger = require('../config/logger');
const ledger = require('./futuresLedger');
const futuresService = require('./futuresService');
const { fillPrice } = require('./tradeFill');
const math = require('./futuresMath');

const EVERY_MS = 1000;
const PASS_LIMIT = 2000; // positions and orders loaded per pass; _id cursors rotate through all of them across passes
const RECOVER_AGE_MS = 15000; // also at startup: a still-draining old process may be mid-op (deploys are stop-then-start)
const SWEEP_EVERY_MS = 5 * 60 * 1000; // futuresOps marker sweep: startup, then this often (it scans Users)
const RECOVER_LIMIT = 50;

let timer = null;
let current = null; // the in-flight pass; a slow pass must never overlap the next one
let stopped = false;
let recovered = false; // the full recoverAll() runs once, at the start of the first pass
const held = new Set(); // symbols this engine holds a mark stream for
let recoverAgeMs = RECOVER_AGE_MS; // tests may set 0
let lastSweep = 0;
const cursors = { pos: null, ord: null }; // last _id of the previous full page; null = start from the beginning

// One page of open, unlocked docs after the cursor, ascending _id. A short page means the end: wrap to the start next pass.
async function nextPage(M, key) {
  const rows = await M.find({ status: 'open', lockOp: null, ...(cursors[key] && { _id: { $gt: cursors[key] } }) }).sort({ _id: 1 }).limit(PASS_LIMIT).lean();
  cursors[key] = rows.length >= PASS_LIMIT ? rows[rows.length - 1]._id : null;
  return rows;
}

const cents = (usd) => Math.round(usd * 100);
const usd = (c) => c / 100;

// first match wins: liquidation, then SL, then TP. Triggers read the mark only.
function triggerOf(p, mark) {
  const long = p.side === 'long';
  if (long ? mark <= p.liqPrice : mark >= p.liqPrice) return 'liquidate';
  if (p.sl != null && (long ? mark <= p.sl : mark >= p.sl)) return 'sl';
  if (p.tp != null && (long ? mark >= p.tp : mark <= p.tp)) return 'tp';
  return null;
}

// Final close of the whole position at `mark`. Liquidation: gross pnl = -margin, credit 0, no fee. TP/SL: market close.
function settleSpec(p, kind, mark) {
  const id = String(p._id);
  const liq = kind === 'liquidate';
  let pnl;
  let fee = 0;
  let credit = 0;
  if (liq) pnl = -cents(p.margin);
  else ({ pnl, fee, credit } = math.closeQuote(p, p.size, mark));
  const now = new Date();
  return {
    userId: p.userId,
    kind,
    deltaCents: credit,
    targets: [{ model: 'Position', id: p._id, expect: { status: 'open', size: p.size, rev: p.rev ?? null } }],
    post: {
      [id]: {
        status: liq ? 'liquidated' : 'closed',
        size: 0,
        margin: 0,
        exitPrice: mark,
        closeReason: liq ? 'liquidation' : kind,
        realizedPnl: usd(cents(p.realizedPnl || 0) + pnl),
        fees: usd(cents(p.fees || 0) + fee),
        closedAt: now,
        updatedAt: now,
        unset: ['activeKey'],
      },
    },
  };
}

// ledger.run never rejects for op-level failures it can classify; a throw mid-op leaves the op pending and recovery
// finishes it (the claimed position stays locked, so no pass touches it meanwhile). -> true if this call settled it.
async function attempt(spec, what) {
  try {
    const r = await ledger.run(spec);
    if (r.ok) logger.info(`risk: ${what} user=${spec.userId}`);
    else if (r.code !== 'POSITION_BUSY') logger.warn(`risk: ${what} not applied (${r.code}) user=${spec.userId}`);
    return !!r.ok;
  } catch (e) {
    logger.error(`risk: ${what} interrupted, recovery will finish it user=${spec.userId}: ${e.message}`);
    return false;
  }
}

const orderCrosses = (o, mark) => (o.side === 'long' ? mark <= o.limitPrice : mark >= o.limitPrice);

// The limit-entry fill as one op: open a new position or add to the existing one, at the LIMIT price. The reservation
// equals margin + fee, so the balance delta is normally 0 (any difference is settled, never lost).
async function fillSpec(o) {
  const orderTarget = { model: 'FuturesOrder', id: o._id, expect: { status: 'open' } };
  const reserved = cents(o.reserved);
  const rejectSpec = (why) => {
    logger.warn(`risk: rejecting futures order ${o._id}: ${why}`);
    return { userId: o.userId, kind: 'cancel', deltaCents: reserved, targets: [orderTarget], post: { [String(o._id)]: { status: 'rejected' } } };
  };
  const key = `${o.userId}:${o.symbol}:${o.side}`;
  const pos = await Position.findOne({ activeKey: key }).lean();
  const now = new Date();

  if (pos) { // add: same leverage only, tier cap on the combined notional
    if (pos.leverage !== o.leverage) return rejectSpec('LEVERAGE_MISMATCH');
    const q = math.addQuote(pos, o.size, o.limitPrice);
    if (math.maxLeverage(o.symbol, q.size * q.entryPrice) < pos.leverage) return rejectSpec('LEVERAGE_TOO_HIGH');
    return {
      userId: o.userId,
      kind: 'fill',
      deltaCents: reserved - q.debit,
      targets: [orderTarget, { model: 'Position', id: pos._id, expect: { status: 'open', size: pos.size, rev: pos.rev ?? null } }],
      post: {
        [String(o._id)]: { status: 'filled', positionId: pos._id, filledAt: now },
        [String(pos._id)]: {
          size: q.size,
          entryPrice: q.entryPrice,
          margin: usd(q.margin),
          mmr: q.mmr,
          liqPrice: q.liqPrice,
          fees: usd(cents(pos.fees || 0) + q.fee),
          ...(o.tp != null && { tp: o.tp }),
          ...(o.sl != null && { sl: o.sl }),
          updatedAt: now,
        },
      },
    };
  }

  const q = math.openQuote(o.side, o.size, o.limitPrice, o.leverage);
  const id = new mongoose.Types.ObjectId();
  return {
    userId: o.userId,
    kind: 'fill',
    deltaCents: reserved - q.debit,
    targets: [
      orderTarget,
      {
        model: 'Position',
        id,
        create: {
          userId: o.userId, symbol: o.symbol, side: o.side, size: o.size, entryPrice: o.limitPrice, leverage: o.leverage,
          margin: usd(q.margin), mmr: q.mmr, liqPrice: q.liqPrice, tp: o.tp ?? null, sl: o.sl ?? null,
          status: 'opening', activeKey: key, realizedPnl: 0, fees: usd(q.fee), openedAt: now, updatedAt: now,
        },
      },
    ],
    post: { [String(o._id)]: { status: 'filled', positionId: id, filledAt: now }, [String(id)]: { status: 'open' } },
    onDuplicate: () => fillSpec(o), // lost the activeKey race: the position exists now, so this builds the add
  };
}

function reconcileHolds(symbols) {
  for (const s of held) if (!symbols.has(s)) { futuresService.release(`${s}USDT`); held.delete(s); }
  for (const s of symbols) if (!held.has(s) && futuresService.hold(`${s}USDT`)) held.add(s);
}

async function pass() {
  try {
    try {
      const sweepMarkers = !recovered || Date.now() - lastSweep >= SWEEP_EVERY_MS;
      const first = !recovered;
      recovered = true;
      if (sweepMarkers) lastSweep = Date.now();
      await ledger.recoverAll({ olderThanMs: recoverAgeMs, ...(!first && { limit: RECOVER_LIMIT }), sweepMarkers }); // startup: all aged pending ops
    } catch (e) {
      logger.error(`risk: recovery failed: ${e.message}`);
    }
    const [positions, orders] = await Promise.all([
      nextPage(Position, 'pos'),
      nextPage(FuturesOrder, 'ord'),
    ]);
    const bySymbol = new Map();
    const bucket = (s) => { let b = bySymbol.get(s); if (!b) bySymbol.set(s, (b = { positions: [], orders: [] })); return b; };
    for (const p of positions) bucket(p.symbol).positions.push(p);
    for (const o of orders) bucket(o.symbol).orders.push(o);
    if (!stopped) reconcileHolds(new Set(bySymbol.keys()));

    for (const [symbol, b] of bySymbol) {
      if (stopped) break;
      let fill = null;
      try {
        fill = await fillPrice(`${symbol}USDT`);
      } catch (e) {
        logger.warn(`risk: price lookup failed for ${symbol}: ${e.message}`);
      }
      if (!fill) continue; // never act on a stale or missing mark
      const mark = fill.price;
      for (const p of b.positions) {
        if (stopped) break;
        const kind = triggerOf(p, mark);
        if (kind) await attempt(settleSpec(p, kind, mark), `${kind} ${p.side} ${p.size} ${symbol} @ ${mark} pos=${p._id}`);
      }
      for (const o of b.orders) {
        if (stopped) break;
        if (!orderCrosses(o, mark)) continue;
        try {
          await attempt(await fillSpec(o), `fill limit ${o.side} ${o.size} ${symbol} @ ${o.limitPrice} order=${o._id}`);
        } catch (e) {
          logger.error(`risk: could not build fill for order ${o._id}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    logger.error(`riskEngine pass failed: ${e.message}`);
  }
}

// One pass; callers during a pass get the same promise. -> the pass's promise (never rejects).
function runOnce() {
  if (!current) current = pass().finally(() => { current = null; });
  return current;
}

function start() {
  if (timer) return;
  stopped = false;
  recovered = false;
  cursors.pos = cursors.ord = null;
  timer = setInterval(() => { if (mongoose.connection.readyState === 1) runOnce(); }, EVERY_MS);
  if (timer.unref) timer.unref();
  logger.info('riskEngine started');
}

// -> promise that resolves when any in-flight pass has finished (it stops at the next symbol/position boundary)
function stop() {
  stopped = true;
  clearInterval(timer);
  timer = null;
  for (const s of held) futuresService.release(`${s}USDT`);
  held.clear();
  return current || Promise.resolve();
}

module.exports = { start, stop, runOnce, _test: { triggerOf, settleSpec, fillSpec, held, PASS_LIMIT, setRecoverAge: (ms) => { recoverAgeMs = ms; } } };
