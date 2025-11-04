const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  cryptoSymbol: { type: String, required: true },
  type: { type: String, enum: ['buy', 'sell'], required: true },
  amount: { type: Number, required: true },
  priceAtTrade: { type: Number, required: true },
  fee: { type: Number, required: true }, 
  date: { type: Date, default: Date.now },
});

tradeSchema.index({ userId: 1, cryptoSymbol: 1 });

const Trade = mongoose.model('Trade', tradeSchema);

module.exports = Trade;
