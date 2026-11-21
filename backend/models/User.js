const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const providerFields = () => ({
  model: { type: String, maxlength: 100 },
  keyEnc: { type: String },
  keyLast4: { type: String, maxlength: 4 },
});

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
  googleId: { type: String, unique: true, sparse: true }, // Google account "sub"; set on first Google sign-in
  name: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  balance: { type: Number, default: 100000 }, // paper USD
  // base symbol -> amount held; authoritative, only ever changed together with balance by one conditional $inc.
  // Keys are validated /^[A-Z0-9]{2,20}$/ before use (a '.' or '$' would break the $inc path).
  holdings: { type: Map, of: Number, default: {} },
  // set once when holdings were first computed from Trade history; absent = not migrated yet. No default on purpose.
  holdingsSyncedAt: { type: Date },
  // per-op idempotency markers for futures ledger ops: key = FuturesOp _id hex, value 1. Absent = not applied / cleaned up.
  futuresOps: { type: Map, of: Number },
  lockedAt: { type: Date }, // set on retired public accounts; their password is unusable
  // user-editable settings (PATCH /api/auth/me); profile has no defaults, preferences do
  profile: {
    bio: { type: String, maxlength: 160 },
    country: { type: String, maxlength: 56 },
    timezone: { type: String, maxlength: 64 },
    avatar: { type: String }, // absent = initials; "emoji:<emoji>" or a validated jpeg/webp data URL (authController.checkAvatar)
  },
  preferences: {
    defaultSymbol: { type: String, match: /^[A-Z0-9]{2,20}$/, default: 'BTCUSDT' },
    defaultTimeframe: { type: String, enum: ['1m', '5m', '15m', '1h', '4h', '1d'], default: '1h' },
    alertToasts: { type: Boolean, default: true },
    alertSound: { type: Boolean, default: false },
    landingPage: { type: String, enum: ['dashboard', 'trade', 'market', 'portfolio', 'derivatives', 'liquidation'], default: 'dashboard' },
    compactTables: { type: Boolean, default: false },
    tickerBar: { type: Boolean, default: true },
    tickerSpeed: { type: String, enum: ['slow', 'normal', 'fast'], default: 'normal' },
    fundingCountdown: { type: Boolean, default: true },
    reduceMotion: { type: Boolean, default: false },
    timeFormat: { type: String, enum: ['auto', '12h', '24h'], default: 'auto' },
    confirmClose: { type: Boolean, default: true }, // read by components/trade/PositionsTable
    defaultLeverage: { type: Number, min: 1, max: 50, default: 10, validate: { validator: Number.isInteger, message: 'must be an integer' } }, // FuturesForm initial leverage
    defaultOrderType: { type: String, enum: ['market', 'limit'], default: 'market' }, // TradeForm/FuturesForm initial order type
  },
  ai: {
    model: { type: String, default: null }, // must be an AI_MODELS id when set; null = server default. Used by provider 'default' only
    provider: { type: String, enum: ['default', 'anthropic', 'openai', 'gemini', 'openrouter', 'custom', 'lmstudio'], default: 'default' },
    // Per-provider settings. keyEnc is AES-GCM ciphertext (services/secretBox), never returned by any endpoint.
    providers: {
      anthropic: { ...providerFields() },
      openai: { ...providerFields() },
      gemini: { ...providerFields() },
      openrouter: { ...providerFields() },
      custom: { ...providerFields(), baseUrl: { type: String, maxlength: 300 } },
      lmstudio: { ...providerFields(), baseUrl: { type: String, maxlength: 300 } }, // keyEnc unused: no key
    },
    systemPrompt: { type: String, default: '', maxlength: 2000 }, // '' = server default style prompt
    temperature: { type: Number, min: 0, max: 1, default: null }, // null = provider default
    length: { type: String, enum: ['short', 'normal', 'detailed'], default: 'normal' },
    includePortfolio: { type: Boolean, default: false }, // consent to put cash/holdings/open positions into the AI context
  },
  tokenVersion: { type: Number, default: 0 }, // in every JWT as `tv`; $inc signs the user out everywhere
  passwordSet: { type: Boolean }, // false only for accounts created by Google sign-in; absent = true (legacy). No default on purpose

  passwordChangedAt: { type: Date }, // tokens issued before this are rejected by middleware/auth
  createdAt: { type: Date, default: Date.now }
});

userSchema.index({ futuresOps: 1 }, { sparse: true }); // marker sweep: users that ever had a futures op

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
