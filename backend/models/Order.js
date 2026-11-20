const mongoose = require('mongoose');

// Limit orders only (market orders fill at once and live in Trade). `reserved` is what the order holds back from the
// user: USD for a buy (amount * limitPrice + fee), coin quantity for a sell. It is released on cancel / used on fill.
const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true }, // base ticker, same as Trade.cryptoSymbol
  side: { type: String, enum: ['buy', 'sell'], required: true },
  type: { type: String, enum: ['limit'], default: 'limit' },
  amount: { type: Number, required: true },
  limitPrice: { type: Number, required: true },
  status: { type: String, enum: ['open', 'filled', 'cancelled', 'rejected', 'error'], default: 'open' },
  reserved: { type: Number, required: true },
  failures: { type: Number, default: 0 }, // clean settle failures; 3 -> rejected + refunded
  fillPrice: { type: Number },
  filledAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
});

orderSchema.index({ userId: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1 });

module.exports = mongoose.model('Order', orderSchema);
