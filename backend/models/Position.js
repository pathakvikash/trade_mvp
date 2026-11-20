const mongoose = require('mongoose');

// Isolated-margin paper futures position (USDT-margined linear perpetual). One open position per user+symbol+side,
// enforced by the unique sparse `activeKey` index: it is set while opening/open and $unset on close, liquidation or void,
// so closed positions never collide. Money fields are USD, `size` is coins. Spec: docs/phase2-leverage.md §1.
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;
const OPEN_STATUSES = ['opening', 'open'];

const positionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true, match: SYMBOL_RE }, // base ticker, same as Order.symbol
  side: { type: String, enum: ['long', 'short'], required: true },
  size: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator(v) { return !OPEN_STATUSES.includes(this.status) || v > 0; },
      message: 'size must be > 0 while the position is opening or open',
    },
  },
  entryPrice: { type: Number, required: true }, // size-weighted average
  leverage: { type: Number, required: true, min: 1, max: 50, validate: { validator: Number.isInteger, message: 'leverage must be an integer' } },
  margin: { type: Number, required: true }, // USD isolated margin currently held
  mmr: { type: Number, required: true }, // maintenance margin rate fixed at open/add
  liqPrice: { type: Number, required: true },
  tp: { type: Number, default: null },
  sl: { type: Number, default: null },
  status: { type: String, enum: ['opening', 'open', 'closed', 'liquidated', 'void'], required: true },
  // No default: an unset key is absent from the document, which is what keeps the unique sparse index working.
  activeKey: { type: String }, // `${userId}:${symbol}:${side}` while opening/open
  realizedPnl: { type: Number, default: 0 }, // USD gross price PnL realised so far
  fees: { type: Number, default: 0 }, // USD open + close fees paid so far
  exitPrice: { type: Number }, // last close price, set on the final close
  closeReason: { type: String, enum: ['manual', 'tp', 'sl', 'liquidation'] },
  lockOp: { type: mongoose.Schema.Types.ObjectId, ref: 'FuturesOp', default: null }, // the op currently mutating it
  rev: { type: Number, default: 0 }, // bumped ($inc) by every mutation; ledger/edit filters pin it against stale snapshots
  openedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  closedAt: { type: Date },
});

positionSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
positionSchema.index({ userId: 1, status: 1, updatedAt: -1 });
positionSchema.index({ status: 1 });

module.exports = mongoose.model('Position', positionSchema);
