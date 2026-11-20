const mongoose = require('mongoose');

const liquidationSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  side: { type: String, enum: ['long', 'short'], required: true },
  price: { type: Number, required: true },
  qty: { type: Number, required: true },
  usd: { type: Number, required: true },
  ts: { type: Number, required: true }, // event time, ms
  at: { type: Date, default: Date.now, expires: 2 * 24 * 3600 }, // TTL index: 2 days (the in-memory buffer holds 24h)
});

liquidationSchema.index({ ts: 1 }); // the reload query filters/sorts on ts only

module.exports = mongoose.model('Liquidation', liquidationSchema);
