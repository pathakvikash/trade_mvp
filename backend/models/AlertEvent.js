const mongoose = require('mongoose');

const alertEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  alertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert', required: true },
  symbol: String,
  metric: String,
  op: String,
  value: Number,
  observed: Number,
  ts: { type: Date, default: Date.now, expires: 30 * 24 * 3600 }, // TTL index: 30 days
});

module.exports = mongoose.model('AlertEvent', alertEventSchema);
