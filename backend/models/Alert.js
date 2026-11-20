const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  symbol: { type: String, required: true },
  metric: { type: String, enum: ['price', 'funding', 'liq_usd_5m'], required: true },
  op: { type: String, enum: ['above', 'below'], required: true },
  value: { type: Number, required: true },
  note: { type: String, default: '', maxlength: 140 },
  active: { type: Boolean, default: true },
  cooldownMin: { type: Number, default: 15, min: 1, max: 1440 },
  lastTriggeredAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Alert', alertSchema);
