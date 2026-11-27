const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Trade = require('../models/Trade');
const Order = require('../models/Order');
const Position = require('../models/Position');
const FuturesOrder = require('../models/FuturesOrder');
const FuturesOp = require('../models/FuturesOp');
const Alert = require('../models/Alert');
const AlertEvent = require('../models/AlertEvent');
const Strategy = require('../models/Strategy');
const Bot = require('../models/Bot');
const BotDecision = require('../models/BotDecision');
const AiConversation = require('../models/AiConversation');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const config = require('../config/config');
const logger = require('../config/logger');
const BaseController = require('./BaseController');
const { AI_MODELS, aiDefaultPrompt, aiServerRules } = require('../services/aiService');
const { PROVIDERS, PROVIDER_IDS } = require('../services/aiProviders');

const GUEST_EMAIL = 'guest@cryptozen.com';
const LEGACY_ADMIN_EMAIL = 'admin@cryptozen.com'; // old seeded admin; its password is in git history
const BAD_LOGIN = { success: false, message: 'Invalid email or password' };
// Compared against when the email is unknown so both failure paths cost one bcrypt round (no timing oracle).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const PREF_DEFAULTS = {
  defaultSymbol: 'BTCUSDT', defaultTimeframe: '1h', alertToasts: true, alertSound: false,
  landingPage: 'dashboard', compactTables: false, tickerBar: true, tickerSpeed: 'normal', fundingCountdown: true,
  reduceMotion: false, timeFormat: 'auto', confirmClose: true, defaultLeverage: 10, defaultOrderType: 'market',
};
const PREFERENCE_FIELDS = Object.keys(PREF_DEFAULTS);
const PROFILE_FIELDS = ['bio', 'country', 'timezone'];

// Explicit whitelist: nothing from the stored document (password, tokenVersion, keyEnc, googleId, balance...) leaks
// through by accident. Defaults are filled here because lean() documents carry none. Keys appear only as keySet/keyLast4.
const publicUser = (u) => {
  const p = u.profile || {};
  const pref = u.preferences || {};
  const ai = u.ai || {};
  const prov = ai.providers || {};
  const providersOut = {};
  for (const id of PROVIDER_IDS) {
    const x = prov[id] || {};
    providersOut[id] = { model: x.model || '', ...(id === 'custom' || id === 'lmstudio' ? { baseUrl: x.baseUrl || '' } : {}), keySet: !!x.keyEnc, keyLast4: x.keyEnc ? (x.keyLast4 || null) : null };
  }
  const preferences = {};
  for (const k of PREFERENCE_FIELDS) preferences[k] = pref[k] ?? PREF_DEFAULTS[k];
  return {
    _id: u._id,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    profile: { bio: p.bio ?? null, country: p.country ?? null, timezone: p.timezone ?? null, avatar: p.avatar ?? null },
    preferences,
    ai: {
      provider: ai.provider || 'default',
      model: ai.model ?? null,
      systemPrompt: ai.systemPrompt || '',
      temperature: ai.temperature ?? null,
      length: ai.length || 'normal',
      includePortfolio: ai.includePortfolio === true,
      providers: providersOut,
    },
    security: { passwordSet: u.passwordSet !== false, googleLinked: !!u.googleId },
  };
};

// Best effort; lazy require keeps the futures/ws stack out of everything that only needs the controller.
const kickSockets = (userId) => {
  try { require('../services/alertService').kick(String(userId)); } catch (e) { logger.warn(`kickSockets failed: ${e.message}`); }
};

// tv = tokenVersion: bumping it on the user (password change, sign out everywhere) invalidates every older token.
const sign = (user) => jwt.sign({ userId: user._id, role: user.role, tv: user.tokenVersion || 0 }, config.jwt.secret, { expiresIn: '24h', algorithm: 'HS256' });

// Register User. `role` is never read from the body: every sign-up is a plain user (admins are set in the database).
exports.registerUser = BaseController.wrap(async (req, res) => {
  const { username, email, password, name } = req.body;

  if (await User.findOne({ email: email.toLowerCase() })) {
    return res.status(400).json({ success: false, message: 'Email already registered' });
  }
  if (await User.findOne({ username: username.toLowerCase() })) {
    return res.status(400).json({ success: false, message: 'Username already taken' });
  }

  let user;
  try {
    user = await User.create({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      password,
      name,
      role: 'user',
      passwordSet: true,
    });
  } catch (e) {
    // lost a race with a concurrent identical sign-up (unique index)
    if (e && e.code === 11000) return res.status(400).json({ success: false, message: 'Email or username already taken' });
    throw e;
  }

  logger.info(`User created successfully: ${user.username}`);
  res.status(201).json({ success: true, message: 'User created successfully', user: publicUser(user) });
});

// Demo guest (opt-in). Never seeds an admin; the password comes from env, never from source.
exports.initializeDefaultUsers = async () => {
  if (process.env.SEED_DEMO_USERS !== 'true') return;
  if (process.env.NODE_ENV === 'production') { // config already refuses this at boot; belt and braces
    logger.error('SEED_DEMO_USERS=true is refused in production; demo guest not seeded');
    return;
  }
  const password = process.env.DEMO_GUEST_PASSWORD;
  if (!password || password.length < 12) {
    logger.warn('SEED_DEMO_USERS=true but DEMO_GUEST_PASSWORD is missing or shorter than 12 chars; demo guest not seeded');
    return;
  }
  try {
    const guest = await User.findOne({ email: GUEST_EMAIL });
    if (!guest) {
      await User.create({ username: 'guest', email: GUEST_EMAIL, password, name: 'Guest User', role: 'user' });
      logger.info('Created demo guest user');
    } else {
      guest.password = password; // the pre-save hook re-hashes it
      guest.role = 'user';
      guest.lockedAt = undefined; // seeding on: the guest is a deliberate, env-protected demo account
      await guest.save();
      logger.info('Updated demo guest password and forced role=user');
    }
  } catch (error) {
    logger.error('Error seeding demo guest:', error);
  }
};

// Retired public accounts: replace the password with a random hash nobody knows, drop to role user, stamp lockedAt.
// Idempotent (only touches accounts without lockedAt). The legacy guest is left to initializeDefaultUsers when seeding is on.
async function lockAccount(email) {
  const hash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const r = await User.updateOne({ email, lockedAt: null }, { $set: { password: hash, role: 'user', lockedAt: new Date() } });
  if (r && r.modifiedCount > 0) logger.warn(`SECURITY: legacy public account ${email} had a publicly known password; it is now locked (random password, role user).`);
}

exports.lockLegacyAccounts = async () => {
  try {
    await lockAccount(LEGACY_ADMIN_EMAIL);
    // the guest stays open only when seeding will actually reset its password from env (see initializeDefaultUsers)
    if (!(process.env.SEED_DEMO_USERS === 'true' && (process.env.DEMO_GUEST_PASSWORD || '').length >= 12)) await lockAccount(GUEST_EMAIL);
  } catch (error) {
    logger.error('Error locking legacy accounts:', error);
  }
};

// Sign-up used to accept role=admin and the code seeded admin@cryptozen.com with a public password. Nothing is
// deleted here; the operator has to review these accounts in the database.
exports.warnAboutAdmins = async () => {
  try {
    const admins = await User.countDocuments({ role: 'admin' });
    if (admins > 0) {
      logger.warn(`SECURITY: ${admins} admin account(s) exist. Sign-up used to allow role=admin and the old seed created an admin with a publicly known password; review them in the database (nothing was changed).`);
    }
  } catch (error) {
    logger.error('Error checking admin accounts:', error);
  }
};

// Login User
exports.loginUser = BaseController.wrap(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() });
  const isMatch = user ? await user.matchPassword(password) : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !isMatch || user.lockedAt) {
    return res.status(401).json(BAD_LOGIN);
  }

  // One-time: accounts created before the paper balance existed (balance 0, never traded) get it on next login.
  if (user.balance === 0 && !(await Trade.exists({ userId: user._id }))) {
    await User.updateOne({ _id: user._id, balance: 0 }, { $set: { balance: User.PAPER_BALANCE } });
  }

  const token = sign(user);

  logger.info(`User logged in successfully: ${user.username}`);
  res.status(200).json({ success: true, token, user: publicUser(user) });
});

// Verify Token
exports.verifyToken = BaseController.wrap(async (req, res) => {
  const user = await User.findById(req.user.userId).select('-password');

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.status(200).json({ success: true, user: publicUser(user) });
});

// Current user plus the AI model allow-list, for the settings screen.
exports.getMe = BaseController.wrap(async (req, res) => {
  const user = await User.findById(req.user.userId).select('-password');

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.status(200).json({ success: true, user: publicUser(user), aiModels: AI_MODELS, aiProviders: PROVIDERS, aiDefaultPrompt, aiServerRules });
});

// Partial update. Validation already rejected unknown keys; only whitelisted dot-paths are ever $set.
exports.updateMe = BaseController.wrap(async (req, res) => {
  const b = req.body;
  const $set = {};
  if (b.name !== undefined) $set.name = b.name;
  for (const k of PROFILE_FIELDS) if (b.profile && b.profile[k] !== undefined) $set[`profile.${k}`] = b.profile[k];
  for (const k of PREFERENCE_FIELDS) if (b.preferences && b.preferences[k] !== undefined) $set[`preferences.${k}`] = b.preferences[k];
  const ai = b.ai || {};
  for (const k of ['model', 'provider', 'systemPrompt', 'temperature', 'length', 'includePortfolio']) if (ai[k] !== undefined) $set[`ai.${k}`] = ai[k];
  // keys are never settable here (PUT /api/ai/keys/:provider); only the model and, for custom/lmstudio, the base URL
  for (const id of PROVIDER_IDS) {
    const pv = (ai.providers && ai.providers[id]) || {};
    if (pv.model !== undefined) $set[`ai.providers.${id}.model`] = pv.model;
    if ((id === 'custom' || id === 'lmstudio') && pv.baseUrl !== undefined) $set[`ai.providers.${id}.baseUrl`] = pv.baseUrl;
  }

  const query = Object.keys($set).length
    ? User.findByIdAndUpdate(req.user.userId, { $set }, { new: true, runValidators: true })
    : User.findById(req.user.userId);
  const user = await query.select('-password');

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.status(200).json({ success: true, user: publicUser(user) });
});

// Change own password (or set a first one when passwordSet === false: Google-created accounts have a random password
// nobody knows, so there is no current password to ask for). The pre-save hook hashes it; passwordChangedAt and the
// tokenVersion bump invalidate every token issued before now; the response carries a fresh token for this session.
const REAUTH_WINDOW_S = 10 * 60;
exports.changePassword = BaseController.wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  const setting = user.passwordSet === false;
  if (setting) {
    // No current password to prove identity, so the session itself must be fresh (a stolen old token must not be enough).
    const iat = req.user.iat;
    if (!iat || Date.now() / 1000 - iat > REAUTH_WINDOW_S) {
      return res.status(403).json({ success: false, code: 'REAUTH_REQUIRED', message: 'For safety, sign out and sign in with Google again, then set your password within 10 minutes.' });
    }
  } else {
    if (typeof currentPassword !== 'string') {
      return res.status(422).json({ success: false, message: 'Current password is required' });
    }
    if (!(await user.matchPassword(currentPassword))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    if (await user.matchPassword(newPassword)) {
      return res.status(400).json({ success: false, message: 'New password must differ from the current password' });
    }
  }

  user.password = newPassword;
  user.passwordChangedAt = new Date();
  user.passwordSet = true;
  await user.save();
  const fresh = await User.findByIdAndUpdate(user._id, { $inc: { tokenVersion: 1 } }, { new: true }); // atomic, after the save
  if (!fresh) return res.status(404).json({ success: false, message: 'User not found' });

  kickSockets(user._id);
  logger.info(`Password ${setting ? 'set' : 'changed'} for user: ${user.username}`);
  res.status(200).json({ success: true, token: sign(fresh) });
});

// Sign out everywhere: bump tokenVersion atomically and hand this session a token with the new value.
exports.logoutAll = BaseController.wrap(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user.userId, { $inc: { tokenVersion: 1 } }, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  kickSockets(user._id);
  logger.info(`Signed out everywhere: ${user.username}`);
  res.status(200).json({ success: true, token: sign(user) });
});

// ---- avatar ----
const AVATAR_MAX_BYTES = 150 * 1024;
const DATA_URL_RE = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
// Emoji sequences only: pictographs plus the joiners/selectors/modifiers/flags/tags that glue them. No other text, so
// the stored value is safe to render anywhere.
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u200D\uFE0E\uFE0F\u20E3\u{E0020}-\u{E007F}])+$/u;

// Server is the authority on the avatar format; returns an error message or null.
function checkAvatar(a) {
  if (typeof a !== 'string') return 'Invalid avatar';
  if (a.startsWith('emoji:')) {
    const e = a.slice(6);
    const n = [...e].length;
    if (n < 1 || n > 16 || !EMOJI_RE.test(e) || !/[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(e)) return 'Avatar emoji is not valid';
    return null;
  }
  if (a.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 64) return 'Avatar image is too large';
  const m = DATA_URL_RE.exec(a);
  if (!m || m[2].length % 4 !== 0) return 'Avatar must be a JPEG or WebP image';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length === 0 || buf.length > AVATAR_MAX_BYTES) return 'Avatar image is too large';
  const jpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const webp = buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
  if ((m[1] === 'jpeg' && !jpeg) || (m[1] === 'webp' && !webp)) return 'Avatar content does not match its type';
  return null;
}

exports.setAvatar = BaseController.wrap(async (req, res) => {
  const err = checkAvatar(req.body.avatar);
  if (err) return res.status(422).json({ success: false, message: err });
  const user = await User.findByIdAndUpdate(req.user.userId, { $set: { 'profile.avatar': req.body.avatar } }, { new: true, runValidators: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.status(200).json({ success: true, user: publicUser(user) });
});

exports.clearAvatar = BaseController.wrap(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user.userId, { $unset: { 'profile.avatar': 1 } }, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  res.status(200).json({ success: true, user: publicUser(user) });
});

// ---- export / delete ----
const stripV = ({ __v, ...rest }) => rest;
const mapHoldings = (h) => (h instanceof Map ? Object.fromEntries(h) : { ...(h || {}) });

// ponytail: loads every document for the user in one response; paginate/stream if histories ever get large.
exports.exportMe = BaseController.wrap(async (req, res) => {
  const userId = req.user.userId;
  const u = await User.findById(userId).lean();
  if (!u) return res.status(404).json({ success: false, message: 'User not found' });
  const [trades, orders, positions, futuresOrders, alerts, strategies, aiConversations, bots, botDecisions] = await Promise.all(
    [Trade, Order, Position, FuturesOrder, Alert, Strategy, AiConversation, Bot, BotDecision].map((M) => M.find({ userId }).lean()),
  );
  const pub = publicUser(u);
  for (const id of PROVIDER_IDS) delete pub.ai.providers[id].keyLast4; // keySet stays; nothing key-derived is exported
  res.set('Content-Disposition', 'attachment; filename="cryptozen-export.json"');
  res.status(200).json({
    exportedAt: new Date().toISOString(),
    note: 'Paper trading data from CryptoZen. No real money is involved. Passwords and saved API keys are never exported.',
    user: { ...pub, balance: u.balance, holdings: mapHoldings(u.holdings) },
    trades: trades.map(stripV),
    orders: orders.map(stripV),
    positions: positions.map(stripV),
    futuresOrders: futuresOrders.map(stripV),
    alerts: alerts.map(stripV),
    strategies: strategies.map(stripV),
    aiConversations: aiConversations.map(stripV),
    bots: bots.map(stripV),
    botDecisions: botDecisions.map(stripV),
  });
});

const OPEN_FUTURES = { success: false, code: 'OPEN_FUTURES', message: 'Close your open futures positions and cancel pending futures orders first.' };
const BOT_RUNNING = { success: false, code: 'BOT_RUNNING', message: 'Stop your running bots first.' };
const hasOpenFutures = async (userId) => {
  const r = await Promise.all([
    Position.exists({ userId, status: { $in: ['opening', 'open'] } }),
    FuturesOrder.exists({ userId, status: { $in: ['placing', 'open'] } }),
    FuturesOp.exists({ userId, status: { $in: ['pending', 'error'] } }),
  ]);
  return r.some(Boolean);
};

// Race-safe order: lock the account FIRST (middleware/auth then rejects every request, so nothing new can start), re-check
// for open futures money, and only then delete. A failed check unlocks again. ponytail: a request that passed auth just
// before the lock can still insert one futures row after the check; the engines tolerate a missing user, the row is orphaned.
exports.deleteMe = BaseController.wrap(async (req, res) => {
  const userId = req.user.userId;
  const user = await User.findById(userId).select('email').lean();
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  if (String(req.body.confirmEmail).trim().toLowerCase() !== String(user.email).toLowerCase()) {
    return res.status(422).json({ success: false, message: 'Email does not match your account' });
  }
  const locked = await User.updateOne({ _id: userId, lockedAt: null }, { $set: { lockedAt: new Date() } });
  if (!locked || locked.modifiedCount !== 1) return res.status(409).json({ success: false, message: 'Account is already being deleted' });
  try {
    const blocked = (await hasOpenFutures(userId)) ? OPEN_FUTURES : (await Bot.exists({ userId, status: 'running' })) ? BOT_RUNNING : null;
    if (blocked) {
      await User.updateOne({ _id: userId }, { $unset: { lockedAt: 1 } });
      return res.status(409).json(blocked);
    }
    for (const M of [Bot, BotDecision, Strategy, AiConversation, AlertEvent, Alert, Order, Trade, FuturesOrder, FuturesOp, Position]) await M.deleteMany({ userId });
    await User.deleteOne({ _id: userId });
  } catch (e) {
    // stays locked: half-deleted money data must not be usable; a human finishes it
    logger.error(`Account deletion failed for ${userId}; account left locked, manual review: ${e.message}`);
    return res.status(500).json({ success: false, message: 'Something went wrong' });
  }
  kickSockets(userId);
  logger.info(`Account deleted: ${userId}`);
  res.status(200).json({ success: true });
});

// DEV ONLY: delete when hosted. Demo credentials for the local test-login box; served only when every gate holds.
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
exports.devHint = (req, res) => {
  const password = process.env.DEMO_GUEST_PASSWORD;
  const allowed = process.env.NODE_ENV === 'development'
    && process.env.SEED_DEMO_USERS === 'true'
    && (password || '').length >= 12
    && LOOPBACK.includes(req.socket && req.socket.remoteAddress);
  if (!allowed) return res.status(404).json({ success: false });
  res.status(200).json({ email: GUEST_EMAIL, password });
};

// Public, not secret: the browser needs the client ID to render the Google button.
exports.authConfig = (req, res) => {
  res.status(200).json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
};

// Google sign-in (Identity Services ID token). The email comes only from the verified token, never from the body.
let oauthClient = null;
const GOOGLE_REFUSED = { success: false, message: 'This account cannot be used with Google sign-in' };

// First free username from the email local part: lowercase [a-z0-9_], random 4-digit suffix while taken.
const usernameFor = async (email) => {
  const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
  const base = (local.length >= 3 ? local : `user${local}`).slice(0, 24);
  let name = base;
  while (await User.findOne({ username: name })) name = `${base}${crypto.randomInt(1000, 10000)}`;
  return name;
};

// Same body as a successful login, for sign-in paths that verified the user elsewhere (Orrery SSO).
exports.sessionFor = (user) => ({ success: true, token: sign(user), user: publicUser(user) });

exports.googleLogin = BaseController.wrap(async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(503).json({ success: false, message: 'Google sign-in is not configured' });

  let payload;
  try {
    oauthClient = oauthClient || new OAuth2Client(clientId);
    const ticket = await oauthClient.verifyIdToken({ idToken: req.body.credential, audience: clientId });
    payload = ticket.getPayload();
  } catch (e) {
    return res.status(401).json({ success: false, message: 'Invalid Google credential' });
  }
  if (!payload || payload.email_verified !== true || !payload.email) {
    return res.status(401).json({ success: false, message: 'Google account email is not verified' });
  }
  const email = payload.email.toLowerCase();

  let user = (await User.findOne({ googleId: payload.sub })) || (await User.findOne({ email }));
  if (user && (user.lockedAt || (user.googleId && user.googleId !== payload.sub))) {
    return res.status(401).json(GOOGLE_REFUSED);
  }
  if (user) {
    if (!user.googleId) {
      user.googleId = payload.sub; // link the existing account on its first Google sign-in
      await user.save();
    }
  } else {
    const name = (payload.name || email.split('@')[0]).trim().slice(0, 60) || 'Google user';
    try {
      user = await User.create({
        username: await usernameFor(email),
        email,
        name,
        password: crypto.randomBytes(32).toString('hex'), // unguessable; the pre-save hook hashes it
        googleId: payload.sub,
        role: 'user',
        passwordSet: false, // the stored password is random; Settings offers set-a-password without a current one
      });
    } catch (e) {
      if (e && e.code === 11000) return res.status(409).json({ success: false, message: 'Please try Google sign-in again' });
      throw e;
    }
    logger.info(`User created via Google: ${user.username}`);
  }

  logger.info(`User logged in via Google: ${user.username}`);
  res.status(200).json({ success: true, token: sign(user), user: publicUser(user) });
});
