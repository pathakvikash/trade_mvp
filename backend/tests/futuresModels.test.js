const mongoose = require('mongoose');
const Position = require('../models/Position');
const FuturesOrder = require('../models/FuturesOrder');
const FuturesOp = require('../models/FuturesOp');
const User = require('../models/User');

// Schema-level checks only: validateSync() never touches the DB.
const oid = () => new mongoose.Types.ObjectId();
const errPaths = (doc) => Object.keys(doc.validateSync()?.errors || {});
// Mongoose adds { background: true } to index options; the spec only fixes the key fields and uniqueness flags.
const indexFields = (model) => model.schema.indexes().map(([fields]) => fields);
const indexOpts = (model, fields) => model.schema.indexes().find(([f]) => JSON.stringify(f) === JSON.stringify(fields))?.[1];

const validPosition = (over = {}) => ({
  userId: oid(), symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10,
  mmr: 0.004, liqPrice: 90.36, status: 'open', activeKey: `${oid()}:BTC:long`, ...over,
});

const validOrder = (over = {}) => ({
  userId: oid(), symbol: 'ETH', side: 'short', size: 2, leverage: 5, limitPrice: 3000, reserved: 1201,
  status: 'placing', ...over,
});

const validOp = (over = {}) => ({
  userId: oid(), kind: 'open', targets: [{ model: 'Position', id: oid() }], deltaCents: -1005,
  post: {}, status: 'pending', ...over,
});

describe('Position model', () => {
  test('valid open position passes and gets defaults', () => {
    const p = new Position(validPosition());
    expect(p.validateSync()).toBeUndefined();
    expect(p.tp).toBeNull();
    expect(p.sl).toBeNull();
    expect(p.lockOp).toBeNull();
    expect(p.realizedPnl).toBe(0);
    expect(p.fees).toBe(0);
    expect(p.openedAt).toBeInstanceOf(Date);
    expect(p.updatedAt).toBeInstanceOf(Date);
  });

  test('activeKey has no default, so a closed position leaves it absent (not null)', () => {
    const p = new Position(validPosition({ status: 'closed', activeKey: undefined, closeReason: 'manual' }));
    expect(p.validateSync()).toBeUndefined();
    expect(p.activeKey).toBeUndefined();
    expect(p.toObject().activeKey).toBeUndefined();
  });

  test('required fields are enforced', () => {
    const required = ['userId', 'symbol', 'side', 'size', 'entryPrice', 'leverage', 'margin', 'mmr', 'liqPrice', 'status'];
    for (const field of required) {
      const doc = validPosition();
      delete doc[field];
      expect(errPaths(new Position(doc))).toContain(field);
    }
  });

  test('side and status enums', () => {
    expect(errPaths(new Position(validPosition({ side: 'buy' })))).toContain('side');
    expect(errPaths(new Position(validPosition({ status: 'pending' })))).toContain('status');
    for (const status of ['opening', 'open', 'closed', 'liquidated', 'void']) {
      expect(errPaths(new Position(validPosition({ status, size: status === 'closed' ? 0 : 1 })))).toEqual([]);
    }
  });

  test('closeReason enum', () => {
    expect(errPaths(new Position(validPosition({ status: 'closed', closeReason: 'manual' })))).toEqual([]);
    expect(errPaths(new Position(validPosition({ status: 'closed', closeReason: 'expired' })))).toContain('closeReason');
  });

  test('leverage is an integer in 1..50', () => {
    expect(errPaths(new Position(validPosition({ leverage: 1 })))).toEqual([]);
    expect(errPaths(new Position(validPosition({ leverage: 50 })))).toEqual([]);
    expect(errPaths(new Position(validPosition({ leverage: 0 })))).toContain('leverage');
    expect(errPaths(new Position(validPosition({ leverage: 51 })))).toContain('leverage');
    expect(errPaths(new Position(validPosition({ leverage: 2.5 })))).toContain('leverage');
  });

  test('symbol must match the base-ticker pattern', () => {
    expect(errPaths(new Position(validPosition({ symbol: 'btc' })))).toContain('symbol');
    expect(errPaths(new Position(validPosition({ symbol: 'BTCUSDT.X' })))).toContain('symbol');
  });

  test('size must be > 0 while opening/open, but may be 0 once closed', () => {
    expect(errPaths(new Position(validPosition({ size: 0 })))).toContain('size');
    expect(errPaths(new Position(validPosition({ status: 'opening', size: 0 })))).toContain('size');
    expect(errPaths(new Position(validPosition({ status: 'closed', size: 0, activeKey: undefined })))).toEqual([]);
    expect(errPaths(new Position(validPosition({ size: -1 })))).toContain('size');
  });

  test('declares the unique sparse activeKey index and the query indexes from the spec', () => {
    expect(indexFields(Position)).toEqual(expect.arrayContaining([{ activeKey: 1 }, { userId: 1, status: 1, updatedAt: -1 }, { status: 1 }]));
    expect(indexOpts(Position, { activeKey: 1 })).toMatchObject({ unique: true, sparse: true });
  });
});

describe('FuturesOrder model', () => {
  test('valid limit entry passes and gets defaults', () => {
    const o = new FuturesOrder(validOrder());
    expect(o.validateSync()).toBeUndefined();
    expect(o.tp).toBeNull();
    expect(o.sl).toBeNull();
    expect(o.lockOp).toBeNull();
    expect(o.positionId).toBeUndefined();
    expect(o.createdAt).toBeInstanceOf(Date);
    expect(o.filledAt).toBeUndefined();
  });

  test('required fields are enforced', () => {
    const required = ['userId', 'symbol', 'side', 'size', 'leverage', 'limitPrice', 'reserved', 'status'];
    for (const field of required) {
      const doc = validOrder();
      delete doc[field];
      expect(errPaths(new FuturesOrder(doc))).toContain(field);
    }
  });

  test('side and status enums', () => {
    expect(errPaths(new FuturesOrder(validOrder({ side: 'buy' })))).toContain('side');
    expect(errPaths(new FuturesOrder(validOrder({ status: 'open_' })))).toContain('status');
    for (const status of ['placing', 'open', 'filled', 'cancelled', 'rejected', 'void']) {
      expect(errPaths(new FuturesOrder(validOrder({ status })))).toEqual([]);
    }
  });

  test('leverage is an integer in 1..50 and symbol matches the pattern', () => {
    expect(errPaths(new FuturesOrder(validOrder({ leverage: 51 })))).toContain('leverage');
    expect(errPaths(new FuturesOrder(validOrder({ leverage: 0 })))).toContain('leverage');
    expect(errPaths(new FuturesOrder(validOrder({ symbol: 'eth' })))).toContain('symbol');
  });

  test('declares the spec indexes', () => {
    expect(indexFields(FuturesOrder)).toEqual(expect.arrayContaining([{ userId: 1, status: 1, createdAt: -1 }, { status: 1 }]));
  });
});

describe('FuturesOp model', () => {
  test('valid journal entry passes and gets defaults', () => {
    const op = new FuturesOp(validOp());
    expect(op.validateSync()).toBeUndefined();
    expect(op.attempts).toBe(0);
    expect(op.post).toEqual({});
    expect(op.lastError).toBeUndefined();
    expect(op.createdAt).toBeInstanceOf(Date);
  });

  test('required fields are enforced', () => {
    const required = ['userId', 'kind', 'deltaCents', 'status'];
    for (const field of required) {
      const doc = validOp();
      delete doc[field];
      expect(errPaths(new FuturesOp(doc))).toContain(field);
    }
  });

  test('kind enum accepts all nine ops and rejects others', () => {
    for (const kind of ['open', 'add', 'close', 'liquidate', 'tp', 'sl', 'place', 'cancel', 'fill']) {
      expect(errPaths(new FuturesOp(validOp({ kind })))).toEqual([]);
    }
    expect(errPaths(new FuturesOp(validOp({ kind: 'modify' })))).toContain('kind');
  });

  test('status enum', () => {
    for (const status of ['pending', 'done', 'rolled_back', 'error']) {
      expect(errPaths(new FuturesOp(validOp({ status })))).toEqual([]);
    }
    expect(errPaths(new FuturesOp(validOp({ status: 'running' })))).toContain('status');
  });

  test('deltaCents must be an integer; zero and negative are allowed', () => {
    expect(errPaths(new FuturesOp(validOp({ deltaCents: 0 })))).toEqual([]);
    expect(errPaths(new FuturesOp(validOp({ deltaCents: 1994 })))).toEqual([]);
    expect(errPaths(new FuturesOp(validOp({ deltaCents: 1.5 })))).toContain('deltaCents');
  });

  test('targets entries need a known model and an id', () => {
    expect(errPaths(new FuturesOp(validOp({ targets: [{ model: 'User', id: oid() }] })))).toContain('targets.0.model');
    expect(errPaths(new FuturesOp(validOp({ targets: [{ model: 'FuturesOrder' }] })))).toContain('targets.0.id');
    const op = new FuturesOp(validOp({ targets: [{ model: 'FuturesOrder', id: oid() }] }));
    expect(op.targets[0]._id).toBeUndefined();
  });

  test('declares the status/createdAt index', () => {
    expect(indexFields(FuturesOp)).toEqual([{ status: 1, createdAt: 1 }]);
  });
});

describe('User.futuresOps', () => {
  const userDoc = () => new User({ username: 'trader', email: 'trader@example.com', password: 'x', name: 'Trader' });

  test('is a Map of Number and survives $set-style writes on a dotted hex key', () => {
    const key = oid().toHexString();
    const u = userDoc();
    u.set(`futuresOps.${key}`, 1);
    expect(u.futuresOps.get(key)).toBe(1);
    expect(u.validateSync()).toBeUndefined();
  });

  test('is additive: balance default is unchanged and futuresOps has no default', () => {
    const u = userDoc();
    expect(u.balance).toBe(100000);
    expect(u.futuresOps).toBeUndefined();
  });
});
