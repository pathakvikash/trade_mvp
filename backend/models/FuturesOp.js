const mongoose = require('mongoose');

// Write-ahead journal for futures money and position mutations. This is the exactly-once mechanism: the frozen
// `post` states and `deltaCents` are written before any target is touched, so recovery can always roll forward.
// Spec: docs/phase2-leverage.md §1 and §3.
const futuresOpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: {
    type: String,
    enum: ['open', 'add', 'close', 'liquidate', 'tp', 'sl', 'place', 'cancel', 'fill', 'leverage'],
    required: true,
  },
  // Locked in this order. No _id per entry: the target id is the identity.
  targets: [{
    _id: false,
    model: { type: String, enum: ['Position', 'FuturesOrder'], required: true },
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
  }],
  deltaCents: { type: Number, required: true, validate: { validator: Number.isInteger, message: 'deltaCents must be an integer' } }, // negative = debit
  // { [targetId hex]: { ...absolute $set fields, $unset?: [...] } }, frozen final state per target
  post: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'done', 'rolled_back', 'error'], required: true },
  attempts: { type: Number, default: 0 },
  lastError: { type: String },
  createdAt: { type: Date, default: Date.now },
});

futuresOpSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model('FuturesOp', futuresOpSchema);
