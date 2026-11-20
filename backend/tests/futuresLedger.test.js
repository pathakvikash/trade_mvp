// futuresLedger: happy paths, rollbacks and crash injection. In-memory fakes apply each conditional update atomically
// (check + apply in one synchronous step, as MongoDB does for one document). A "crash" is a throw injected immediately
// before or after one of the numbered ledger steps; recovery must then roll forward (or back) exactly once.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models/User', () => ({ updateOne: jest.fn(), findById: jest.fn(), find: jest.fn() }));
jest.mock('../models/Position', () => ({ create: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/FuturesOrder', () => ({ create: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/FuturesOp', () => ({ create: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn(), find: jest.fn() }));

const logger = require('../config/logger');
const User = require('../models/User');
const Position = require('../models/Position');
const FuturesOrder = require('../models/FuturesOrder');
const FuturesOp = require('../models/FuturesOp');
const ledger = require('../services/futuresLedger');

const U = '64b7f0c2a1b2c3d4e5f60718';
const P1 = '64b7f0c2a1b2c3d4e5f60a01';
const P2 = '64b7f0c2a1b2c3d4e5f60a02';
const O1 = '64b7f0c2a1b2c3d4e5f60b01';

const IDKEYS = ['_id', 'lockOp', 'userId'];
const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
const setPath = (o, path, v) => {
  const ks = path.split('.');
  const last = ks.pop();
  ks.reduce((x, k) => (x[k] = x[k] || {}), o)[last] = v;
};
const unsetPath = (o, path) => {
  const ks = path.split('.');
  const last = ks.pop();
  const t = ks.reduce((x, k) => (x == null ? x : x[k]), o);
  if (t) delete t[last];
};
const matches = (doc, filter) => Object.entries(filter).every(([k, c]) => {
  let v = get(doc, k);
  const id = IDKEYS.includes(k);
  if (id && v != null) v = String(v);
  if (c && typeof c === 'object' && !(c instanceof Date) && !(id && c._bsontype)) {
    if ('$exists' in c) return (v !== undefined) === c.$exists;
    if ('$gte' in c) return v >= c.$gte;
    if ('$lte' in c) return v <= c.$lte;
    if ('$gt' in c) return String(v) > String(c.$gt);
    if ('$in' in c) return c.$in.includes(v);
    if ('$ne' in c) return JSON.stringify(v) !== JSON.stringify(c.$ne);
    return false;
  }
  if (c == null) return v == null; // null matches a missing field
  return v === (id ? String(c) : c);
});
const apply = (doc, upd) => {
  for (const [k, d] of Object.entries(upd.$inc || {})) setPath(doc, k, (get(doc, k) || 0) + d);
  for (const [k, v] of Object.entries(upd.$set || {})) setPath(doc, k, v);
  for (const k of Object.keys(upd.$unset || {})) unsetPath(doc, k);
};
const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : d);

let users;
let positions;
let orders;
let ops;
let inject; // { tag, when: 'before'|'after', nth }
let counts;
let violations;
let dbDown; // true: every User call throws (persistent DB failure)

const crash = (tag, when) => {
  if (when === 'before') counts[tag] = (counts[tag] || 0) + 1;
  if (inject && inject.tag === tag && inject.when === when && counts[tag] === (inject.nth || 1)) {
    inject = null;
    throw new Error(`crash ${when} ${tag}`);
  }
};
// runs `fn` synchronously-atomically, with crash points around it; returns a thenable with the chain methods we use
const op = (tag, fn) => {
  const p = (async () => { crash(tag, 'before'); await Promise.resolve(); const r = fn(); crash(tag, 'after'); return r; })();
  p.lean = () => p;
  p.select = () => p;
  return p;
};
const sortable = (rows) => {
  let r = rows;
  const c = { select: () => c, sort: () => { r = [...r].sort((a, b) => (a.createdAt - b.createdAt) || String(a._id).localeCompare(String(b._id))); return c; }, limit: (n) => { r = r.slice(0, n); return c; }, lean: () => c, then: (res, rej) => Promise.resolve(r.map(clone)).then(res, rej) };
  return c;
};

const coll = (M, rows, { unique } = {}) => {
  M.create.mockImplementation((d) => op('lock', () => {
    if (unique && d.activeKey && rows().some((x) => x.activeKey === d.activeKey)) throw Object.assign(new Error('E11000 dup'), { code: 11000 });
    rows().push({ ...d });
    return d;
  }));
  M.findOneAndUpdate.mockImplementation((f, upd) => op('lock', () => { const d = rows().find((x) => matches(x, f)); if (!d) return null; apply(d, upd); return clone(d); }));
  M.updateOne.mockImplementation((f, upd) => op(upd.$set && !f.status ? 'post' : 'rb', () => { const d = rows().find((x) => matches(x, f)); if (d) apply(d, upd); return { matchedCount: d ? 1 : 0 }; }));
  M.findOne.mockImplementation((f) => op('read', () => clone(rows().find((x) => matches(x, f)) || null)));
};

beforeEach(() => {
  jest.resetAllMocks();
  users = { [U]: { balance: 1000 } };
  positions = [];
  orders = [];
  ops = [];
  inject = null;
  counts = {};
  violations = [];
  dbDown = false;
  coll(Position, () => positions, { unique: true });
  coll(FuturesOrder, () => orders);
  FuturesOp.create.mockImplementation((d) => op('op.create', () => { ops.push({ attempts: 0, createdAt: new Date(), ...d }); return d; }));
  FuturesOp.findById.mockImplementation((id) => op('read', () => clone(ops.find((x) => String(x._id) === String(id)) || null)));
  FuturesOp.findOneAndUpdate.mockImplementation((f, upd) => op('opfau', () => { const d = ops.find((x) => matches(x, f)); if (!d) return null; apply(d, upd); return clone(d); }));
  FuturesOp.updateOne.mockImplementation((f, upd) => op(upd.$set && upd.$set.status === 'done' ? 'done' : 'opu', () => { const d = ops.find((x) => matches(x, f)); if (d) apply(d, upd); return { matchedCount: d ? 1 : 0 }; }));
  FuturesOp.find.mockImplementation((f) => sortable(ops.filter((x) => matches(x, f))));
  User.updateOne.mockImplementation((f, upd) => op(upd.$inc ? 'debit' : 'unset', () => {
    if (dbDown) throw new Error('db down');
    if (upd.$unset) { // the marker may only go once the op is done
      const key = Object.keys(upd.$unset)[0].split('.')[1];
      const o = ops.find((x) => String(x._id) === key);
      if (!o || o.status !== 'done') violations.push(`marker ${key} unset while op ${o && o.status}`);
    }
    const u = users[String(f._id)];
    if (!u || !matches(u, Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_id')))) return { matchedCount: 0 };
    apply(u, upd);
    return { matchedCount: 1 };
  }));
  User.find.mockImplementation((f) => sortable(Object.entries(users).map(([_id, u]) => Object.assign(u, { _id })).filter((u) => matches(u, f))));
  User.findById.mockImplementation((id) => op('uread', () => { if (dbDown) throw new Error('db down'); return clone(users[String(id)] || null); }));
});
afterEach(() => expect(violations).toEqual([]));

const openPos = (over = {}) => ({ _id: P1, userId: U, symbol: 'BTC', side: 'long', size: 1, margin: 10, status: 'open', activeKey: `${U}:BTC:long`, ...over });
const openSpec = (id = P1, delta = -1005) => ({
  userId: U, kind: 'open', deltaCents: delta,
  targets: [{ model: 'Position', id, create: { userId: U, symbol: 'BTC', side: 'long', size: 1, margin: 10, status: 'opening', activeKey: `${U}:BTC:long` } }],
  post: { [id]: { status: 'open' } },
});
const closeSpec = (id = P1, delta = 1994, rev = null) => ({
  userId: U, kind: 'close', deltaCents: delta,
  targets: [{ model: 'Position', id, expect: { status: 'open', size: 1, rev } }],
  post: { [id]: { status: 'closed', size: 0, exitPrice: 110, $unset: ['activeKey'] } },
});
const cancelSpec = () => ({
  userId: U, kind: 'cancel', deltaCents: 500,
  targets: [{ model: 'FuturesOrder', id: O1, expect: { status: 'open' } }],
  post: { [O1]: { status: 'cancelled' } },
});
// order O1 (open) fills into a brand new position P2, no balance change
const fillSpec = () => ({
  userId: U, kind: 'fill', deltaCents: 0,
  targets: [
    { model: 'FuturesOrder', id: O1, expect: { status: 'open' } },
    { model: 'Position', id: P2, create: { userId: U, symbol: 'BTC', side: 'long', size: 1, status: 'opening', activeKey: `${U}:BTC:long` } },
  ],
  post: { [O1]: { status: 'filled', positionId: P2 }, [P2]: { status: 'open' } },
});

test('open: debits once, position opens, claim and marker gone', async () => {
  const r = await ledger.run(openSpec());
  expect(r).toMatchObject({ ok: true, op: { status: 'done' } });
  expect(users[U].balance).toBeCloseTo(1000 - 10.05, 6);
  expect(users[U].futuresOps).toEqual({});
  expect(positions[0]).toMatchObject({ status: 'open', activeKey: `${U}:BTC:long` });
  expect(positions[0].lockOp).toBeUndefined();
});

test('close: credits once, applies frozen state, $unset removes activeKey', async () => {
  positions.push(openPos());
  const r = await ledger.run(closeSpec());
  expect(r.ok).toBe(true);
  expect(users[U].balance).toBeCloseTo(1019.94, 6);
  expect(positions[0]).toMatchObject({ status: 'closed', exitPrice: 110 });
  expect(positions[0].activeKey).toBeUndefined();
  expect(positions[0].lockOp).toBeUndefined();
});

test('cancel credits the reservation; fill moves two targets with delta 0', async () => {
  orders.push({ _id: O1, userId: U, status: 'open' });
  expect((await ledger.run(cancelSpec())).ok).toBe(true);
  expect(users[U].balance).toBeCloseTo(1005, 6);
  expect(orders[0].status).toBe('cancelled');
  orders[0].status = 'open';
  expect((await ledger.run(fillSpec())).ok).toBe(true);
  expect(users[U].balance).toBeCloseTo(1005, 6);
  expect(orders[0]).toMatchObject({ status: 'filled', positionId: P2 });
  expect(positions[0]).toMatchObject({ _id: P2, status: 'open' });
});

test('insufficient funds: rolled_back, new position voided with activeKey unset, balance untouched', async () => {
  users[U].balance = 5;
  const r = await ledger.run(openSpec());
  expect(r).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE', op: { status: 'rolled_back' } });
  expect(users[U].balance).toBe(5);
  expect(positions[0]).toMatchObject({ status: 'void' });
  expect(positions[0].activeKey).toBeUndefined();
  expect(positions[0].lockOp).toBeUndefined();
  expect(users[U].futuresOps).toBeUndefined();
});

test('lock lost (snapshot size changed): POSITION_BUSY, rolled_back, other locks released', async () => {
  orders.push({ _id: O1, userId: U, status: 'open' });
  positions.push(openPos({ size: 2 }));
  const spec = closeSpec();
  spec.targets.unshift({ model: 'FuturesOrder', id: O1, expect: { status: 'open' } });
  const r = await ledger.run(spec);
  expect(r).toMatchObject({ ok: false, code: 'POSITION_BUSY', op: { status: 'rolled_back' } });
  expect(orders[0].lockOp).toBeUndefined();
  expect(positions[0].lockOp).toBeUndefined();
  expect(users[U].balance).toBe(1000);
});

test('two closes racing on one position: one settles, the other gets POSITION_BUSY', async () => {
  positions.push(openPos());
  const [a, b] = await Promise.all([ledger.run(closeSpec()), ledger.run(closeSpec())]);
  expect([a.ok, b.ok].sort()).toEqual([false, true]);
  expect([a, b].find((r) => !r.ok).code).toBe('POSITION_BUSY');
  expect(users[U].balance).toBeCloseTo(1019.94, 6);
});

test('E11000 on activeKey: onDuplicate spec runs once as the add', async () => {
  positions.push(openPos());
  const r = await ledger.run({
    ...openSpec(P2),
    onDuplicate: async () => ({
      userId: U, kind: 'add', deltaCents: -500,
      targets: [{ model: 'Position', id: P1, expect: { status: 'open', size: 1 } }],
      post: { [P1]: { size: 2 } },
    }),
  });
  expect(r).toMatchObject({ ok: true, op: { kind: 'add' } });
  expect(positions.find((p) => p._id === P1).size).toBe(2);
  expect(users[U].balance).toBeCloseTo(995, 6);
  expect(ops.find((o) => o.kind === 'open')).toMatchObject({ status: 'rolled_back' });
  expect(positions).toHaveLength(1);
});

test('E11000 without onDuplicate: DUPLICATE_ACTIVE, rolled back', async () => {
  positions.push(openPos());
  const r = await ledger.run(openSpec(P2));
  expect(r).toMatchObject({ ok: false, code: 'DUPLICATE_ACTIVE' });
  expect(users[U].balance).toBe(1000);
});

// ---- crash injection -------------------------------------------------------------------------------------------------
const SCENARIOS = {
  open: { spec: openSpec, setup: () => {}, targets: 1, final: () => { expect(users[U].balance).toBeCloseTo(989.95, 6); expect(positions[0]).toMatchObject({ status: 'open' }); expect(positions[0].lockOp).toBeUndefined(); }, initial: () => { expect(users[U].balance).toBe(1000); expect(positions.every((p) => p.status === 'void' && !p.activeKey && !p.lockOp)).toBe(true); } },
  close: { spec: closeSpec, setup: () => positions.push(openPos()), targets: 1, final: () => { expect(users[U].balance).toBeCloseTo(1019.94, 6); expect(positions[0]).toMatchObject({ status: 'closed' }); expect(positions[0].activeKey).toBeUndefined(); expect(positions[0].lockOp).toBeUndefined(); }, initial: () => { expect(users[U].balance).toBe(1000); expect(positions[0]).toMatchObject({ status: 'open', size: 1 }); expect(positions[0].lockOp).toBeUndefined(); } },
  fill: { spec: fillSpec, setup: () => orders.push({ _id: O1, userId: U, status: 'open' }), targets: 2, final: () => { expect(users[U].balance).toBe(1000); expect(orders[0]).toMatchObject({ status: 'filled' }); expect(orders[0].lockOp).toBeUndefined(); expect(positions).toHaveLength(1); expect(positions[0]).toMatchObject({ status: 'open' }); expect(positions[0].lockOp).toBeUndefined(); }, initial: () => { expect(orders[0]).toMatchObject({ status: 'open' }); expect(orders[0].lockOp).toBeUndefined(); expect(positions.every((p) => p.status === 'void' && !p.activeKey && !p.lockOp)).toBe(true); } },
  cancel: { spec: cancelSpec, setup: () => orders.push({ _id: O1, userId: U, status: 'open' }), targets: 1, final: () => { expect(users[U].balance).toBeCloseTo(1005, 6); expect(orders[0]).toMatchObject({ status: 'cancelled' }); }, initial: () => { expect(users[U].balance).toBe(1000); expect(orders[0]).toMatchObject({ status: 'open' }); expect(orders[0].lockOp).toBeUndefined(); } },
};
const POINTS = [];
for (const [tag, nths] of [['op.create', [1]], ['lock', [1, 2]], ['debit', [1]], ['post', [1, 2]], ['done', [1]], ['unset', [1]]]) {
  for (const when of ['before', 'after']) for (const nth of nths) POINTS.push([tag, when, nth]);
}

describe.each(Object.keys(SCENARIOS))('crash injection: %s', (name) => {
  const sc = SCENARIOS[name];
  test.each(POINTS.filter(([tag, , nth]) => nth <= (tag === 'lock' || tag === 'post' ? sc.targets : 1)))('throw %s step %s (#%s) then recoverAll twice', async (tag, when, nth) => {
    sc.setup();
    inject = { tag, when, nth };
    await expect(ledger.run(sc.spec())).rejects.toThrow('crash');
    const none = tag === 'op.create' && when === 'before';
    const back = (tag === 'op.create' && when === 'after') || (tag === 'lock' && (when === 'before' || nth < sc.targets));
    await ledger.recoverAll();
    await ledger.recoverAll(); // idempotent: the second pass finds nothing pending
    if (none) { expect(ops).toHaveLength(0); sc.initial(); return; }
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe(back ? 'rolled_back' : 'done');
    (back ? sc.initial : sc.final)();
    expect(users[U].futuresOps || {}).toEqual({});
    // a third, forced replay of the finished op changes nothing
    await ledger.recover(ops[0]._id);
    (back ? sc.initial : sc.final)();
  });
});

test('crash after step 2: five concurrent recoverers apply the debit exactly once', async () => {
  inject = { tag: 'lock', when: 'after', nth: 1 };
  await expect(ledger.run(openSpec())).rejects.toThrow('crash');
  await Promise.all([1, 2, 3, 4, 5].map(() => ledger.recover(ops[0]._id)));
  await ledger.recoverAll();
  expect(users[U].balance).toBeCloseTo(989.95, 6);
  expect(ops[0]).toMatchObject({ status: 'done' });
});

test('crash between 3 and 4: replayed three times, balance moves once', async () => {
  inject = { tag: 'debit', when: 'after', nth: 1 };
  await expect(ledger.run(openSpec())).rejects.toThrow('crash');
  expect(users[U].balance).toBeCloseTo(989.95, 6);
  expect(users[U].futuresOps[String(ops[0]._id)]).toBe(1);
  for (let i = 0; i < 3; i++) await ledger.recover(ops[0]._id);
  expect(users[U].balance).toBeCloseTo(989.95, 6);
});

test('marker already set (debit applied, crash) and balance now low: still rolls forward, never re-debits', async () => {
  inject = { tag: 'debit', when: 'after', nth: 1 };
  await expect(ledger.run(openSpec())).rejects.toThrow('crash');
  users[U].balance = 0;
  await ledger.recoverAll();
  expect(users[U].balance).toBe(0);
  expect(ops[0].status).toBe('done');
});

test('crash after step 2, balance drops before recovery: recovery rolls back and voids', async () => {
  inject = { tag: 'lock', when: 'after', nth: 1 };
  await expect(ledger.run(openSpec())).rejects.toThrow('crash');
  users[U].balance = 3;
  await ledger.recoverAll();
  expect(ops[0]).toMatchObject({ status: 'rolled_back', lastError: 'INSUFFICIENT_BALANCE' });
  expect(users[U].balance).toBe(3);
  expect(positions[0]).toMatchObject({ status: 'void' });
  expect(positions[0].activeKey).toBeUndefined();
});

test('recoverAll honours olderThanMs and limit', async () => {
  inject = { tag: 'lock', when: 'after', nth: 1 };
  await expect(ledger.run(openSpec())).rejects.toThrow('crash');
  expect(await ledger.recoverAll({ olderThanMs: 60000 })).toBe(0);
  expect(ops[0].status).toBe('pending');
  expect(await ledger.recoverAll({ olderThanMs: 0, limit: 1 })).toBe(1);
  expect(ops[0].status).toBe('done');
});

test('run and recoverAll in the same tick: recovery never steals a running op', async () => {
  positions.push(openPos());
  const p = ledger.run(closeSpec());
  const rec = (async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await ledger.recoverAll(); } })();
  const [r] = await Promise.all([p, rec]);
  expect(r.ok).toBe(true);
  expect(users[U].balance).toBeCloseTo(1019.94, 6);
  expect(ops).toHaveLength(1);
});

test('10 failed recoveries: op goes terminal error, target stays locked, logged for manual review', async () => {
  positions.push(openPos());
  inject = { tag: 'lock', when: 'after', nth: 1 };
  await expect(ledger.run(closeSpec())).rejects.toThrow('crash');
  dbDown = true;
  for (let i = 1; i <= 9; i++) {
    await ledger.recoverAll();
    expect(ops[0]).toMatchObject({ status: 'pending', attempts: i });
  }
  await ledger.recoverAll();
  expect(ops[0]).toMatchObject({ status: 'error', attempts: 10 });
  expect(String(positions[0].lockOp)).toBe(String(ops[0]._id));
  expect(positions[0].status).toBe('open'); // frozen, not touched
  expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('FUTURES OP ERROR'));
  dbDown = false;
  expect(await ledger.recoverAll()).toBe(0); // terminal: never retried
  expect(String(positions[0].lockOp)).toBe(String(ops[0]._id));
  expect(users[U].balance).toBe(1000);
});

test('missing user: run rejects, recovery counts attempts instead of throwing', async () => {
  positions.push(openPos());
  delete users[U];
  await expect(ledger.run(closeSpec())).rejects.toThrow('missing');
  await expect(ledger.recoverAll()).resolves.toBe(1);
  expect(ops[0].attempts).toBe(1);
  expect(String(positions[0].lockOp)).toBe(String(ops[0]._id));
});

test('applyPost bumps Position.rev; a stale expect.rev (A-B-A, same status and size) is refused and moves no money', async () => {
  positions.push(openPos());
  // another op already ran on this position and left size/status as they were
  await ledger.run({ userId: U, kind: 'edit', deltaCents: 0, targets: [{ model: 'Position', id: P1, expect: { status: 'open', size: 1, rev: null } }], post: { [P1]: { tp: 5 } } });
  expect(positions[0].rev).toBe(1);
  const r = await ledger.run(closeSpec(P1, 1994, null)); // snapshot taken before that op
  expect(r).toMatchObject({ ok: false, code: 'POSITION_BUSY' });
  expect(users[U].balance).toBe(1000);
  expect(positions[0]).toMatchObject({ status: 'open', tp: 5 });
  expect(positions[0].lockOp).toBeUndefined();
  expect((await ledger.run(closeSpec(P1, 1994, 1))).ok).toBe(true); // fresh snapshot works
});

test('balance guard tolerates float dust, not a real shortfall', async () => {
  users[U].balance = 10.049999999; // dust under a $10.05 debit
  expect((await ledger.run(openSpec())).ok).toBe(true);
  expect(users[U].balance).toBeGreaterThan(-1e-6);
  positions.length = 0;
  users[U].balance = 10.04; // a real shortfall
  const r = await ledger.run(openSpec(P2));
  expect(r).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
});

test('exact all-in debit after fractional-cent credits succeeds', async () => {
  users[U].balance = 0;
  for (let i = 0; i < 10; i++) await ledger.run({ userId: U, kind: 'cancel', deltaCents: 1, targets: [], post: {} }); // 10 x $0.01 -> 0.09999999999999999
  const bal = users[U].balance;
  expect(bal).toBeLessThan(0.1);
  const r = await ledger.run({ ...openSpec(P2, -10), targets: openSpec(P2, -10).targets });
  expect(r.ok).toBe(true);
  expect(users[U].balance).toBeGreaterThan(-1e-6);
});

describe('marker sweep', () => {
  const marker = (id, status) => { ops.push({ _id: id, status, userId: U, kind: 'open', targets: [], post: {}, attempts: 0, createdAt: new Date() }); users[U].futuresOps = { ...(users[U].futuresOps || {}), [id]: 1 }; };
  test('cleans markers of done ops; error-op markers stay and never block a batch', async () => {
    for (let i = 0; i < 3; i++) users[`64b7f0c2a1b2c3d4e5f6${String(i).padStart(4, '0')}`] = { balance: 1, futuresOps: { ['e' + i]: 1 } };
    for (let i = 0; i < 3; i++) ops.push({ _id: 'e' + i, status: 'error', userId: U, targets: [], post: {}, attempts: 10, createdAt: new Date() });
    marker('d1', 'done');
    await ledger.recoverAll({ sweepMarkers: true });
    expect(users[U].futuresOps).toEqual({});
    expect(Object.keys(users).filter((k) => users[k].futuresOps && users[k].futuresOps.e0 === 1 || users[k].futuresOps && users[k].futuresOps.e1 === 1).length).toBe(2);
  });
  test('sweepMarkers:false skips the User scan', async () => {
    marker('d2', 'done');
    await ledger.recoverAll({ sweepMarkers: false });
    expect(User.find).not.toHaveBeenCalled();
    expect(users[U].futuresOps).toEqual({ d2: 1 });
  });
});
