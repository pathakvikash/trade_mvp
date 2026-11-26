const mongoose = require('mongoose');

// A bot = one accepted, hashed strategy spec + one symbol + interval + hard limits. See context/bot-trading-plan.md.
// spec is stored only after parseSpec (inert JSON). acceptedHash is checked against a recomputed hash before every start.
const STATUSES = ['proposed', 'declined', 'paused', 'running', 'stopped', 'killed'];

const botSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, maxlength: 60 },
  strategyId: { type: mongoose.Schema.Types.ObjectId, default: null },
  spec: { type: mongoose.Schema.Types.Mixed, required: true },
  specHash: { type: String, required: true },
  symbol: { type: String, required: true, match: /^[A-Z0-9]{2,20}$/ }, // base ticker
  interval: { type: String, required: true, enum: ['5m', '15m', '1h', '4h', '1d'] },
  sizeUsd: { type: Number, required: true },
  leverage: { type: Number, required: true },
  limits: {
    maxPositionUsd: { type: Number, required: true },
    maxLeverage: { type: Number, required: true },
    dailyLossUsd: { type: Number, required: true },
    maxTradesPerDay: { type: Number, required: true },
    symbols: { type: [String], required: true },
  },
  status: { type: String, enum: STATUSES, default: 'proposed', index: true },
  rev: { type: Number, default: 0 }, // bumped by every edit so an accept that raced an edit cannot win
  acceptedHash: { type: String, default: null },
  acceptedAt: { type: Date, default: null },
  disclosureVersion: { type: Number, default: null },
  generation: { type: Number, default: 0 },
  lastBarTime: { type: Number, default: 0 },
  positionId: { type: mongoose.Schema.Types.ObjectId, default: null },
  entryBarTime: { type: Number, default: null },
  day: { key: { type: String, default: '' }, trades: { type: Number, default: 0 }, realizedCents: { type: Number, default: 0 } },
  startMark: { type: Number, default: null },
  startedAt: { type: Date, default: null },
  runningSince: { type: Date, default: null }, // set on every start; orders the 3-running cap race
  errors: { type: Number, default: 0 },
  stopReason: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Bot', botSchema);
module.exports.STATUSES = STATUSES;
