// The single executor for every futures money/position mutation (API and risk engine). Spec: docs/phase2-leverage.md §3.
// Write-ahead journal (FuturesOp) -> claim targets via lockOp -> one conditional $inc on User guarded by a per-op marker
// -> frozen final state per target -> op done -> marker removed. Every step is idempotent; crashes are handled by rolling
// FORWARD from the journal (recover), never by compensating writes.
//
// opSpec = {
//   userId, kind, deltaCents (integer, negative = debit),
//   targets: [{ model: 'Position'|'FuturesOrder', id,            // id always supplied (pre-generated ObjectId for new docs)
//               create?: {...fields},                              // new doc (status 'opening'/'placing'); lockOp + _id added here
//               expect?: { status, size, rev } }],                 // lock filter for existing docs; Position specs pin `rev`
//                                                                   // (bumped by every write) so an A-B-A snapshot can't match
//   post: { [targetIdHex]: { ...$set fields, $unset?: [fields] } }, // frozen final state; `unset` is accepted as an alias
//   onDuplicate?: async () => opSpec                               // open lost the activeKey race (E11000): build the 'add' spec
// }
// run(opSpec) -> { op, ok, code? } ; code in POSITION_BUSY | INSUFFICIENT_BALANCE | DUPLICATE_ACTIVE
const mongoose = require('mongoose');
const logger = require('../config/logger');

const MAX_ATTEMPTS = 10;
const model = (name) => require(`../models/${name}`); // lazy: models load only when first used
const markerPath = (opId) => `futuresOps.${opId}`;
const idStr = (x) => String(x);
const DUST = 1e-6; // USD: float drift tolerated by the balance guard (a net overdraft never exceeds this)
const SWEEP_BATCH = 200;

// In-process per-op serialisation: a recover() can never interleave with the run() that is still executing the same op
// (it would otherwise see half-taken locks). ponytail: single node only; cross-process safety rests on the recovery age gate.
const chains = new Map();
function serial(key, fn) {
  const tail = (chains.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  const settled = tail.catch(() => {});
  chains.set(key, settled);
  settled.then(() => { if (chains.get(key) === settled) chains.delete(key); });
  return tail;
}

// Takes the targets' locks in order; stops at the first failure. -> null | 'POSITION_BUSY' | 'DUPLICATE_ACTIVE'
async function lockAll(opId, targets) {
  for (const t of targets) {
    const M = model(t.model);
    if (t.create) {
      try {
        await M.create({ ...t.create, _id: t.id, lockOp: opId });
      } catch (e) {
        if (e && e.code === 11000) return 'DUPLICATE_ACTIVE';
        throw e;
      }
    } else {
      const got = await M.findOneAndUpdate({ _id: t.id, lockOp: null, ...(t.expect || {}) }, { $set: { lockOp: opId } });
      if (!got) return 'POSITION_BUSY';
    }
  }
  return null;
}

// Step 3. -> 'applied' | 'already' | 'insufficient'. Throws when the user is missing or the DB keeps failing.
async function debit(op) {
  const path = markerPath(op._id);
  const delta = op.deltaCents / 100;
  const filter = { _id: op.userId, [path]: { $exists: false }, ...(op.deltaCents < 0 && { balance: { $gte: -delta - DUST } }) };
  const User = model('User');
  for (let i = 0; i < 3; i++) {
    const r = await User.updateOne(filter, { $inc: { balance: delta }, $set: { [path]: 1 } });
    if ((r && (r.matchedCount ?? r.n ?? r.modifiedCount)) > 0) return 'applied';
    const u = await User.findById(op.userId).select(`balance ${path}`).lean();
    if (!u) throw new Error(`user ${op.userId} missing`);
    if (u.futuresOps && u.futuresOps[idStr(op._id)]) return 'already';
    if (op.deltaCents < 0 && u.balance < -delta - DUST) return 'insufficient';
    // matched nothing yet nothing explains it: balance moved between the two reads, try again
  }
  throw new Error('user debit did not match');
}

const clearMarker = (op) => model('User').updateOne({ _id: op.userId }, { $unset: { [markerPath(op._id)]: 1 } });

// Releases the claim and voids documents that never became real (opening/placing). Idempotent via the lockOp filter.
async function rollBack(op, code) {
  for (const t of op.targets) {
    const M = model(t.model);
    await M.updateOne({ _id: t.id, lockOp: op._id, status: { $in: ['opening', 'placing'] } }, { $set: { status: 'void' }, $unset: { activeKey: 1, lockOp: 1 } });
    await M.updateOne({ _id: t.id, lockOp: op._id }, { $unset: { lockOp: 1 } });
  }
  await model('FuturesOp').updateOne({ _id: op._id, status: 'pending' }, { $set: { status: 'rolled_back', lastError: code } });
}

// Step 4: frozen state into each target, only while this op still holds it.
async function applyPost(op) {
  for (const t of op.targets) {
    const { $unset, unset, ...set } = (op.post || {})[idStr(t.id)] || {};
    const un = { lockOp: 1 };
    for (const k of $unset || unset || []) un[k] = 1;
    // Position.rev is a monotonic version: every mutation bumps it, so a stale `expect` (same status/size, different state) fails.
    await model(t.model).updateOne({ _id: t.id, lockOp: op._id }, { $set: set, $unset: un, ...(t.model === 'Position' && { $inc: { rev: 1 } }) });
  }
}

// Drives an op from whatever state the DB is in to its end. Used by run (after locking) and recover. Caller holds serial().
async function settle(opId) {
  const Op = model('FuturesOp');
  const op = await Op.findById(opId).lean();
  if (!op) throw new Error(`op ${opId} missing`);
  if (op.status === 'done') { await clearMarker(op); return; } // crashed between 5 and 6
  if (op.status !== 'pending') return;

  const u = await model('User').findById(op.userId).select(markerPath(op._id)).lean();
  if (!u) throw new Error(`user ${op.userId} missing`);
  const marked = !!(u.futuresOps && u.futuresOps[idStr(op._id)]);
  if (!marked) {
    // Step 3 has not run (the marker outlives every later step), so every target must still be claimed by us; if one is
    // not, the crash hit during step 2 and nothing was applied: roll back.
    for (const t of op.targets) {
      if (!(await model(t.model).findOne({ _id: t.id, lockOp: op._id }).select('_id').lean())) return rollBack(op, 'INCOMPLETE_LOCK');
    }
    if ((await debit(op)) === 'insufficient') return rollBack(op, 'INSUFFICIENT_BALANCE');
  }
  await applyPost(op); // 4
  await Op.updateOne({ _id: op._id, status: 'pending' }, { $set: { status: 'done' } }); // 5
  await clearMarker(op); // 6
}

async function run(spec) {
  const _id = new mongoose.Types.ObjectId();
  const targets = spec.targets;
  if (targets.some((t) => !t.id)) throw new Error('every ledger target needs an id');
  const Op = model('FuturesOp');
  const code = await serial(idStr(_id), async () => {
    await Op.create({ _id, userId: spec.userId, kind: spec.kind, targets: targets.map((t) => ({ model: t.model, id: t.id })), deltaCents: spec.deltaCents, post: spec.post || {}, status: 'pending', attempts: 0 }); // 1
    const failed = await lockAll(_id, targets); // 2
    if (failed) {
      await rollBack({ _id, targets: targets.map((t) => ({ model: t.model, id: t.id })) }, failed);
      return failed;
    }
    await settle(_id); // 3-6
    return null;
  });
  const op = await Op.findById(_id).lean();
  if (code === 'DUPLICATE_ACTIVE' && spec.onDuplicate && !spec._retried) {
    return run({ ...(await spec.onDuplicate()), _retried: true });
  }
  if (op.status === 'done') return { op, ok: true };
  return { op, ok: false, code: code || op.lastError };
}

// Rolls one pending op forward (or back) from the journal. Never throws for op-level failures: they count an attempt and
// after MAX_ATTEMPTS the op goes terminal 'error' with its targets left locked ("under review"). -> fresh op | null
function recover(arg) {
  const id = idStr(arg && arg._id ? arg._id : arg);
  return serial(id, async () => {
    const Op = model('FuturesOp');
    const cur = await Op.findById(id).lean();
    if (!cur) return null;
    if (cur.status === 'pending') {
      const op = await Op.findOneAndUpdate({ _id: id, status: 'pending' }, { $inc: { attempts: 1 } }, { new: true }).lean();
      if (!op) return Op.findById(id).lean();
      try {
        await settle(id);
      } catch (e) {
        logger.warn(`futures op ${id} recovery attempt ${op.attempts} failed: ${e.message}`);
        if (op.attempts >= MAX_ATTEMPTS) {
          logger.error(`FUTURES OP ERROR op=${id} kind=${op.kind} user=${op.userId} after ${op.attempts} attempts: ${e.message}; manual review`);
          await Op.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'error', lastError: String(e.message).slice(0, 300) } }).catch(() => {});
        } else {
          await Op.updateOne({ _id: id }, { $set: { lastError: String(e.message).slice(0, 300) } }).catch(() => {});
        }
      }
    } else if (cur.status === 'done') {
      await settle(id).catch((e) => logger.warn(`futures op ${id} marker cleanup failed: ${e.message}`));
    }
    return Op.findById(id).lean();
  });
}

// Startup and engine passes (olderThanMs: 15000 on both; limit: 50 on passes). -> number of ops visited.
// sweepMarkers (default true; the engine runs it at startup and every few minutes, not every pass) also cleans markers a
// crash left between steps 5 and 6: walks Users with a non-empty futuresOps by _id cursor, so permanent 'error' ops' markers
// (skipped here) never occupy a batch slot.
async function recoverAll({ olderThanMs = 0, limit = 0, sweepMarkers = true } = {}) {
  let q = model('FuturesOp').find({ status: 'pending', createdAt: { $lte: new Date(Date.now() - olderThanMs) } }).sort({ createdAt: 1 });
  if (limit > 0) q = q.limit(limit);
  const ops = await q.lean();
  for (const op of ops) await recover(op._id);
  if (!sweepMarkers) return ops.length;
  let last = null;
  for (;;) {
    const f = { futuresOps: { $exists: true, $ne: {} }, ...(last && { _id: { $gt: last } }) };
    const batch = await model('User').find(f).select('futuresOps').sort({ _id: 1 }).limit(SWEEP_BATCH).lean();
    for (const u of batch) {
      for (const key of Object.keys(u.futuresOps || {})) {
        const o = await model('FuturesOp').findById(key).select('status').lean();
        if (o && o.status === 'done') await recover(key); // pending ones are the pass above's job (age gate); 'error' stays put
      }
    }
    if (batch.length < SWEEP_BATCH) break;
    last = batch[batch.length - 1]._id;
  }
  return ops.length;
}

module.exports = { run, recover, recoverAll, MAX_ATTEMPTS };
