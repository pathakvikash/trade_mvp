const mongoose = require('mongoose');

// spec is stored only after parseSpec (strict, inert JSON); it is never executed, only interpreted by services/strategy.
const strategySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, maxlength: 60 },
  spec: { type: mongoose.Schema.Types.Mixed, required: true },
  specHash: { type: String, required: true }, // sha256 of the canonical (key-sorted) JSON
  symbol: { type: String, maxlength: 20 },
  origin: { type: String, enum: ['ai', 'user'], default: 'user' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Strategy', strategySchema);
