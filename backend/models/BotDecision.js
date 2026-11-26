const mongoose = require('mongoose');

// Append-only audit log of what a bot decided and why. `reason` is built in code, never model text.
// The partial unique index on {botId, barTime} is the one-decision-per-bar claim used by the engine (WP3).
const DAY = 24 * 3600 * 1000;

const botDecisionSchema = new mongoose.Schema({
  botId: { type: mongoose.Schema.Types.ObjectId, ref: 'Bot', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  at: { type: Date, default: Date.now },
  kind: { type: String, enum: ['tick', 'risk', 'observed', 'lifecycle'], required: true },
  barTime: { type: Number }, // open time (s) of the decided bar; tick rows only
  action: { type: String, enum: ['open_long', 'open_short', 'close', 'hold', 'skip', 'missed'] },
  status: { type: String, enum: ['intent', 'done', 'failed', 'abandoned'], default: 'done' },
  reason: { type: mongoose.Schema.Types.Mixed },
  positionId: { type: mongoose.Schema.Types.ObjectId },
  mark: Number,
  fillPrice: Number,
  feeCents: Number,
  pnlCents: Number,
  candlesSource: String,
  expiresAt: { type: Date, default() { return new Date(Date.now() + (this.action === 'hold' ? 14 : 365) * DAY); } },
});

botDecisionSchema.index({ botId: 1, barTime: 1 }, { unique: true, partialFilterExpression: { barTime: { $type: 'number' } } });
botDecisionSchema.index({ botId: 1, at: -1 });
botDecisionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('BotDecision', botDecisionSchema);
