const mongoose = require('mongoose');

// Futures limit ENTRY orders only (market entries fill at once and live in Position). `reserved` is the USD held back at
// placement: margin + open fee at limitPrice, released on cancel, consumed on fill. Reduce-only exits are out of scope.
// Spec: docs/phase2-leverage.md §1.
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;

const futuresOrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true, match: SYMBOL_RE }, // base ticker, same as Order.symbol
  side: { type: String, enum: ['long', 'short'], required: true },
  size: { type: Number, required: true }, // coins
  leverage: { type: Number, required: true, min: 1, max: 50, validate: { validator: Number.isInteger, message: 'leverage must be an integer' } },
  limitPrice: { type: Number, required: true },
  tp: { type: Number, default: null },
  sl: { type: Number, default: null },
  reserved: { type: Number, required: true }, // USD = margin + open fee at limitPrice
  status: { type: String, enum: ['placing', 'open', 'filled', 'cancelled', 'rejected', 'void'], required: true },
  lockOp: { type: mongoose.Schema.Types.ObjectId, ref: 'FuturesOp', default: null },
  positionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Position' }, // set on fill
  createdAt: { type: Date, default: Date.now },
  filledAt: { type: Date },
});

futuresOrderSchema.index({ userId: 1, status: 1, createdAt: -1 });
futuresOrderSchema.index({ status: 1 });

module.exports = mongoose.model('FuturesOrder', futuresOrderSchema);
