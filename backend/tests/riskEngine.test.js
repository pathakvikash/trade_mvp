// riskEngine: liquidation / SL / TP / limit fills against an in-memory fake ledger that locks, applies and unlocks in one
// synchronous step (as the real ledger's conditional updates are atomic per document), so exactly-once is observable.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../models/Position', () => ({ find: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/FuturesOrder', () => ({ find: jest.fn() }));
jest.mock('../services/futuresLedger', () => ({ run: jest.fn(), recoverAll: jest.fn() }));
jest.mock('../services/futuresService', () => ({ hold: jest.fn(), release: jest.fn() }));
jest.mock('../services/tradeFill', () => ({ fillPrice: jest.fn() }));

const Position = require('../models/Position');
const FuturesOrder = require('../models/FuturesOrder');
const ledger = require('../services/futuresLedger');
const futuresService = require('../services/futuresService');
const { fillPrice } = require('../services/tradeFill');
const engine = require('../services/riskEngine');

const U = '64b7f0c2a1b2c3d4e5f60718';
let positions;
let orders;
let balanceCents;
let seq;
let prices; // symbol -> mark | null

const hex = () => String(++seq).padStart(24, 'a');
// V1: long 1 BTC @100 L10, margin $10, liq 90.36144578
const longPos = (over = {}) => ({ _id: hex(), userId: U, symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, mmr: 0.004, liqPrice: 90.36144578, tp: null, sl: null, status: 'open', activeKey: `${U}:BTC:long`, realizedPnl: 0, fees: 0.05, openedAt: new Date(), ...over });
const shortPos = (over = {}) => longPos({ side: 'short', size: 2, leverage: 20, margin: 10, mmr: 0.004, liqPrice: 104.58167331, activeKey: `${U}:BTC:short`, ...over });
const limitOrder = (over = {}) => ({ _id: hex(), userId: U, symbol: 'BTC', side: 'long', size: 1, leverage: 10, limitPrice: 100, tp: null, sl: null, reserved: 10.05, status: 'open', createdAt: new Date(), ...over });

const chain = (rows) => {
  let r = rows;
  const c = { sort: () => { r = [...r].sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0)); return c; }, limit: (n) => { r = r.slice(0, n); return c; }, lean: () => c, then: (res, rej) => Promise.resolve(r.map((x) => ({ ...x }))).then(res, rej) };
  return c;
};
const free = (d) => d.status === 'open' && !d.lockOp;
const coll = (m) => (m === 'Position' ? positions : orders);

beforeEach(async () => {
  jest.resetAllMocks();
  positions = [];
  orders = [];
  balanceCents = 100000;
  seq = 0;
  prices = { BTC: 100 };
  fillPrice.mockImplementation(async (s) => { const p = prices[s.replace('USDT', '')]; return p ? { price: p, ageMs: 10 } : null; });
  const after = (f) => (d) => !f._id || d._id > f._id.$gt;
  Position.find.mockImplementation((f) => chain(positions.filter(free).filter(after(f))));
  Position.findOne.mockImplementation((f) => ({ lean: async () => { const p = positions.find((x) => x.activeKey === f.activeKey && x.status !== 'closed'); return p ? { ...p } : null; } }));
  FuturesOrder.find.mockImplementation((f) => chain(orders.filter(free).filter(after(f))));
  ledger.recoverAll.mockResolvedValue(0);
  // fake ledger: all targets locked, balance moved and post applied in ONE synchronous step after one tick
  ledger.run.mockImplementation(async (spec) => {
    await Promise.resolve();
    const docs = [];
    for (const t of spec.targets) {
      if (t.create) { docs.push({ t, doc: { ...t.create, _id: t.id }, isNew: true }); continue; }
      const doc = coll(t.model).find((d) => String(d._id) === String(t.id));
      if (!doc || doc.lockOp || Object.entries(t.expect || {}).some(([k, v]) => (doc[k] ?? null) !== (v ?? null))) return { ok: false, code: 'POSITION_BUSY' };
      docs.push({ t, doc });
    }
    balanceCents += spec.deltaCents;
    for (const { t, doc, isNew } of docs) {
      if (isNew) coll(t.model).push(doc);
      const { unset = [], ...set } = spec.post[String(t.id)] || {};
      Object.assign(doc, set);
      if (t.model === 'Position') doc.rev = (doc.rev || 0) + 1;
      for (const k of unset) delete doc[k];
    }
    return { ok: true, op: { kind: spec.kind } };
  });
  engine.start(); // resets stopped / recovered; the timer never fires (no mongo connection)
});
afterEach(() => engine.stop());

const kinds = () => ledger.run.mock.calls.map((c) => c[0].kind);

describe('liquidation', () => {
  test('long: liquidates when mark <= liqPrice, user gets $0, margin forfeited', async () => {
    const p = longPos();
    positions.push(p);
    prices.BTC = 90.36144579; // just above
    await engine.runOnce();
    expect(ledger.run).not.toHaveBeenCalled();
    prices.BTC = 90.36144578; // exactly at
    await engine.runOnce();
    expect(kinds()).toEqual(['liquidate']);
    expect(balanceCents).toBe(100000); // no credit
    expect(p).toMatchObject({ status: 'liquidated', size: 0, margin: 0, exitPrice: 90.36144578, closeReason: 'liquidation', realizedPnl: -10, fees: 0.05 });
    expect(p.activeKey).toBeUndefined();
    expect(p.lockOp).toBeUndefined();
  });

  test('short: liquidates when mark >= liqPrice, not before', async () => {
    const p = shortPos();
    positions.push(p);
    prices.BTC = 104.5;
    await engine.runOnce();
    expect(ledger.run).not.toHaveBeenCalled();
    prices.BTC = 104.58167331;
    await engine.runOnce();
    expect(kinds()).toEqual(['liquidate']);
    expect(balanceCents).toBe(100000);
    expect(p).toMatchObject({ status: 'liquidated', closeReason: 'liquidation' });
  });

  test('a gap past liq with SL set: liquidation wins over SL', async () => {
    positions.push(longPos({ sl: 95 }));
    prices.BTC = 80;
    await engine.runOnce();
    expect(kinds()).toEqual(['liquidate']);
  });
});

describe('TP / SL', () => {
  test('TP closes the whole position at mark and credits closeQuote (V3: 1994c)', async () => {
    const p = longPos({ tp: 110 });
    positions.push(p);
    prices.BTC = 110;
    await engine.runOnce();
    expect(kinds()).toEqual(['tp']);
    expect(ledger.run.mock.calls[0][0].deltaCents).toBe(1994);
    expect(balanceCents).toBe(101994);
    expect(p).toMatchObject({ status: 'closed', closeReason: 'tp', exitPrice: 110, size: 0, realizedPnl: 10, fees: 0.11 });
  });

  test('SL on a short at mark; SL beats TP when both are crossed', async () => {
    const p = shortPos({ sl: 102, tp: 120 }); // tp 120 crossed (mark <= tp) AND sl 102 crossed (mark >= sl) at 103
    positions.push(p);
    prices.BTC = 103;
    await engine.runOnce();
    expect(kinds()).toEqual(['sl']);
    expect(p.closeReason).toBe('sl');
  });

  test('no trigger inside the band; null tp/sl never fire', async () => {
    positions.push(longPos({ tp: 120, sl: 95 }), longPos({ activeKey: 'x' }));
    prices.BTC = 100;
    await engine.runOnce();
    expect(ledger.run).not.toHaveBeenCalled();
  });
});

describe('exactly once', () => {
  test('repeated and concurrent passes settle a trigger once', async () => {
    positions.push(longPos({ tp: 110 }));
    prices.BTC = 111;
    const a = engine.runOnce();
    expect(engine.runOnce()).toBe(a); // non-overlapping: same in-flight promise
    await a;
    await engine.runOnce();
    await engine.runOnce();
    expect(ledger.run).toHaveBeenCalledTimes(1);
    expect(balanceCents).toBe(100000 + 1000 + 1100 - 6); // margin + pnl @111 - fee (ceil 5.55)
  });

  test('a user close racing the engine in the same tick: one settlement, the other gets POSITION_BUSY', async () => {
    const p = longPos({ tp: 110 });
    positions.push(p);
    prices.BTC = 110;
    const userClose = ledger.run({ userId: U, kind: 'close', deltaCents: 1994, targets: [{ model: 'Position', id: p._id, expect: { status: 'open', size: 1 } }], post: { [p._id]: { status: 'closed', size: 0, closeReason: 'manual' } } });
    const [r] = await Promise.all([userClose, engine.runOnce()]);
    expect(r.ok).toBe(true);
    expect(balanceCents).toBe(101994); // once
    expect(p.closeReason).toBe('manual'); // engine lost the claim (or the position had left the open query)
  });

  test('a locked position is not loaded; a throw mid-op leaves it for recovery and does not stop the pass', async () => {
    const a = longPos({ tp: 110 });
    const b = longPos({ tp: 110, activeKey: 'b' });
    const locked = longPos({ tp: 110, activeKey: 'c', lockOp: 'op1' });
    positions.push(a, b, locked);
    prices.BTC = 110;
    ledger.run.mockImplementationOnce(async () => { throw new Error('db blip'); });
    await engine.runOnce();
    expect(ledger.run).toHaveBeenCalledTimes(2); // a threw, b still processed, locked never attempted
    expect(b.status).toBe('closed');
    expect(locked.status).toBe('open');
  });
});

describe('prices', () => {
  test('missing or failing price skips the symbol, other symbols still run', async () => {
    positions.push(longPos({ tp: 110 }), longPos({ symbol: 'ETH', activeKey: 'e', tp: 110 }), longPos({ symbol: 'SOL', activeKey: 's', tp: 110 }));
    prices.BTC = null;
    prices.ETH = 110;
    fillPrice.mockImplementation(async (s) => {
      if (s === 'SOLUSDT') throw new Error('rest down');
      return prices[s.replace('USDT', '')] ? { price: 110, ageMs: 5 } : null;
    });
    await engine.runOnce();
    expect(ledger.run).toHaveBeenCalledTimes(1);
    expect(ledger.run.mock.calls[0][0].targets[0].id).toBe(positions[1]._id);
  });
});

describe('bounded passes', () => {
  test('1200 positions across symbols: one price lookup per symbol, all triggers settled', async () => {
    for (let i = 0; i < 1200; i++) positions.push(longPos({ symbol: ['BTC', 'ETH', 'SOL'][i % 3], activeKey: `k${i}`, liqPrice: i < 600 ? 150 : 1 }));
    prices.BTC = prices.ETH = prices.SOL = 100;
    await engine.runOnce();
    expect(fillPrice).toHaveBeenCalledTimes(3);
    expect(ledger.run).toHaveBeenCalledTimes(600);
  });

  test('a pass loads at most 2000 positions', async () => {
    for (let i = 0; i < 2500; i++) positions.push(longPos({ activeKey: `k${i}`, liqPrice: 150 }));
    await engine.runOnce();
    expect(ledger.run).toHaveBeenCalledTimes(2000);
    await engine.runOnce(); // the rest next pass
    expect(ledger.run).toHaveBeenCalledTimes(2500);
  });
});

describe('limit entry orders', () => {
  test('long fills when mark <= limit, at the LIMIT price, delta 0, new position', async () => {
    const o = limitOrder({ tp: 120, sl: 95 });
    orders.push(o);
    prices.BTC = 101;
    await engine.runOnce();
    expect(ledger.run).not.toHaveBeenCalled();
    prices.BTC = 99;
    await engine.runOnce();
    expect(kinds()).toEqual(['fill']);
    const spec = ledger.run.mock.calls[0][0];
    expect(spec.deltaCents).toBe(0);
    expect(balanceCents).toBe(100000);
    expect(o).toMatchObject({ status: 'filled' });
    const pos = positions[0];
    expect(pos).toMatchObject({ status: 'open', symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, tp: 120, sl: 95, fees: 0.05, activeKey: `${U}:BTC:long` });
    expect(pos.liqPrice).toBeCloseTo(90.36144578, 8);
    expect(String(o.positionId)).toBe(String(pos._id));
  });

  test('short fills when mark >= limit', async () => {
    orders.push(limitOrder({ side: 'short' }));
    prices.BTC = 99;
    await engine.runOnce();
    expect(ledger.run).not.toHaveBeenCalled();
    prices.BTC = 100.5;
    await engine.runOnce();
    expect(positions[0]).toMatchObject({ side: 'short', entryPrice: 100, activeKey: `${U}:BTC:short` });
  });

  test('fill into an existing same-leverage position adds (V4-style size-weighted entry)', async () => {
    const p = longPos();
    positions.push(p);
    orders.push(limitOrder({ limitPrice: 120, reserved: 12.06, tp: 150 }));
    prices.BTC = 110; // long: mark <= 120
    await engine.runOnce();
    expect(positions).toHaveLength(1);
    expect(p).toMatchObject({ size: 2, entryPrice: 110, margin: 22, tp: 150 });
    expect(p.liqPrice).toBeCloseTo(99.39759036, 8);
    expect(p.fees).toBeCloseTo(0.05 + 0.06, 8);
    expect(balanceCents).toBe(100000);
  });

  test('leverage mismatch with an existing position: order rejected and fully refunded', async () => {
    positions.push(longPos({ leverage: 5 }));
    const o = limitOrder();
    orders.push(o);
    await engine.runOnce();
    expect(kinds()).toEqual(['cancel']);
    expect(o.status).toBe('rejected');
    expect(balanceCents).toBe(101005);
  });

  test('a lost activeKey race re-builds the fill as an add through onDuplicate', async () => {
    const o = limitOrder();
    const spec = await engine._test.fillSpec(o);
    expect(spec.targets[1].create).toBeDefined();
    positions.push(longPos());
    const again = await spec.onDuplicate();
    expect(again.targets[1]).toMatchObject({ model: 'Position', expect: { status: 'open', size: 1 } });
  });
});

describe('recovery, drain, holds', () => {
  test('every pass is age-gated (15s); startup has no limit; marker sweep at startup then every 5 min', async () => {
    await engine.runOnce();
    await engine.runOnce();
    await engine.runOnce();
    expect(ledger.recoverAll.mock.calls).toEqual([
      [{ olderThanMs: 15000, sweepMarkers: true }],
      [{ olderThanMs: 15000, limit: 50, sweepMarkers: false }],
      [{ olderThanMs: 15000, limit: 50, sweepMarkers: false }],
    ]);
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);
    await engine.runOnce();
    spy.mockRestore();
    expect(ledger.recoverAll.mock.calls[3]).toEqual([{ olderThanMs: 15000, limit: 50, sweepMarkers: true }]);
  });

  test('setRecoverAge(0) lets tests recover fresh ops', async () => {
    engine._test.setRecoverAge(0);
    await engine.runOnce();
    engine._test.setRecoverAge(15000);
    expect(ledger.recoverAll.mock.calls[0][0].olderThanMs).toBe(0);
  });

  test('more open positions than PASS_LIMIT: all are checked within two passes (cursor on _id)', async () => {
    const n = engine._test.PASS_LIMIT + 300;
    for (let i = 0; i < n; i++) positions.push(longPos({ activeKey: `k${i}`, tp: 110 }));
    prices.BTC = 111; // every position hits TP
    await engine.runOnce();
    expect(positions.filter((p) => p.status === 'closed')).toHaveLength(engine._test.PASS_LIMIT);
    await engine.runOnce();
    expect(positions.filter((p) => p.status === 'closed')).toHaveLength(n);
  });

  test('cursor wraps: items before the cursor are checked once the tail is exhausted', async () => {
    const L = engine._test.PASS_LIMIT;
    for (let i = 0; i < L + 1; i++) positions.push(longPos({ activeKey: `k${i}` })); // none trigger at 100
    await engine.runOnce(); // page 1 full, cursor set
    await engine.runOnce(); // tail (1 item), short page -> wrap
    const first = positions.reduce((a, b) => (a._id < b._id ? a : b));
    first.tp = 99; // triggers at mark 100 (long tp: mark >= tp)
    await engine.runOnce(); // wrapped: starts from the beginning again
    expect(first.status).toBe('closed');
  });

  test('stale liquidation (old liqPrice) after add + partial close is refused: no money, position stays open', async () => {
    const p = longPos();
    positions.push(p);
    const stale = { ...p };
    positions[0].rev = 2; positions[0].liqPrice = 50; // re-margined meanwhile, size back to 1
    const r = await ledger.run(engine._test.settleSpec(stale, 'liquidate', 90));
    expect(r.ok).toBe(false);
    expect(balanceCents).toBe(100000);
    expect(positions[0].status).toBe('open');
  });

  test('stale snapshot (A-B-A): settle spec built from an old read cannot close a re-sized position', async () => {
    const p = longPos({ tp: 110 });
    positions.push(p);
    const stale = { ...p };
    prices.BTC = 111;
    // meanwhile: add (size 2) then partial close (size 1 again) -> same status/size, new rev, TP cleared
    const live = positions[0];
    live.rev = 2; live.tp = null;
    const r = await ledger.run(engine._test.settleSpec(stale, 'tp', 111));
    expect(r).toEqual({ ok: false, code: 'POSITION_BUSY' });
    expect(balanceCents).toBe(100000);
    expect(live.status).toBe('open');
  });

  test('a failing recovery does not block the pass', async () => {
    ledger.recoverAll.mockRejectedValue(new Error('db'));
    positions.push(longPos({ tp: 110 }));
    prices.BTC = 110;
    await engine.runOnce();
    expect(kinds()).toEqual(['tp']);
  });

  test('stop() resolves only after the in-flight pass has ended', async () => {
    positions.push(longPos({ tp: 110 }), longPos({ tp: 110, activeKey: 'b' }));
    prices.BTC = 110;
    let release;
    const gate = new Promise((r) => { release = r; });
    ledger.run.mockImplementationOnce(async () => { await gate; return { ok: true }; });
    const pass = engine.runOnce();
    await new Promise((r) => setImmediate(r));
    let stopped = false;
    const s = engine.stop().then(() => { stopped = true; });
    await new Promise((r) => setImmediate(r));
    expect(stopped).toBe(false);
    release();
    await s;
    await pass;
    expect(stopped).toBe(true);
    expect(ledger.run).toHaveBeenCalledTimes(1); // the second position was not started after stop
    await expect(engine.stop()).resolves.toBeUndefined(); // idle stop resolves at once
  });

  test('holds the mark stream for symbols with open positions/orders, releases dropped ones and all on stop', async () => {
    futuresService.hold.mockReturnValue(true);
    const p = longPos();
    positions.push(p, longPos({ symbol: 'ETH', activeKey: 'e' }));
    orders.push(limitOrder({ symbol: 'SOL', limitPrice: 1 }));
    prices.BTC = prices.ETH = prices.SOL = 100;
    await engine.runOnce();
    expect(futuresService.hold.mock.calls.map((c) => c[0]).sort()).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    await engine.runOnce(); // no double hold
    expect(futuresService.hold).toHaveBeenCalledTimes(3);
    positions.splice(1, 1); // ETH position gone
    await engine.runOnce();
    expect(futuresService.release).toHaveBeenCalledWith('ETHUSDT');
    await engine.stop();
    expect(futuresService.release.mock.calls.map((c) => c[0]).sort()).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });
});
