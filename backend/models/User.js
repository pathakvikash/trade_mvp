const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true 
  },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  balance: { type: Number, default: 100000 }, // paper USD
  // base symbol -> amount held; authoritative, only ever changed together with balance by one conditional $inc.
  // Keys are validated /^[A-Z0-9]{2,20}$/ before use (a '.' or '$' would break the $inc path).
  holdings: { type: Map, of: Number, default: {} },
  // set once when holdings were first computed from Trade history; absent = not migrated yet. No default on purpose.
  holdingsSyncedAt: { type: Date },
  lockedAt: { type: Date }, // set on retired public accounts; their password is unusable
  // user-editable settings (PATCH /api/auth/me); profile has no defaults, preferences do
  profile: {
    bio: { type: String, maxlength: 160 },
    country: { type: String, maxlength: 56 },
    timezone: { type: String, maxlength: 64 },
  },
  preferences: {
    defaultSymbol: { type: String, match: /^[A-Z0-9]{2,20}$/, default: 'BTCUSDT' },
    defaultTimeframe: { type: String, enum: ['1m', '5m', '15m', '1h', '4h', '1d'], default: '1h' },
    alertToasts: { type: Boolean, default: true },
    alertSound: { type: Boolean, default: false },
  },
  ai: {
    model: { type: String, default: null }, // must be an AI_MODELS id when set; null = server default
  },
  passwordChangedAt: { type: Date }, // tokens issued before this are rejected by middleware/auth
  createdAt: { type: Date, default: Date.now }
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

const User = mongoose.model('User', userSchema);

User.PAPER_BALANCE = 100000; // keep equal to the balance default above

module.exports = User;
