const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Trade = require('../models/Trade');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const config = require('../config/config');
const logger = require('../config/logger');
const BaseController = require('./BaseController');
const { AI_MODELS } = require('../services/aiService');

const GUEST_EMAIL = 'guest@cryptozen.com';
const LEGACY_ADMIN_EMAIL = 'admin@cryptozen.com'; // old seeded admin; its password is in git history
const BAD_LOGIN = { success: false, message: 'Invalid email or password' };
// Compared against when the email is unknown so both failure paths cost one bcrypt round (no timing oracle).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// Explicit fields only: nothing from the stored document (password, lockedAt, balance...) leaks through by accident.
const publicUser = (u) => {
  const p = u.profile || {};
  const pref = u.preferences || {};
  return {
    _id: u._id,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    profile: { bio: p.bio ?? null, country: p.country ?? null, timezone: p.timezone ?? null },
    preferences: {
      defaultSymbol: pref.defaultSymbol,
      defaultTimeframe: pref.defaultTimeframe,
      alertToasts: pref.alertToasts,
      alertSound: pref.alertSound,
    },
    ai: { model: (u.ai && u.ai.model) ?? null },
  };
};

const PROFILE_FIELDS = ['bio', 'country', 'timezone'];
const PREFERENCE_FIELDS = ['defaultSymbol', 'defaultTimeframe', 'alertToasts', 'alertSound'];
const sign = (user) => jwt.sign({ userId: user._id, role: user.role }, config.jwt.secret, { expiresIn: '24h', algorithm: 'HS256' });

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

  res.status(200).json({ success: true, user: publicUser(user), aiModels: AI_MODELS });
});

// Partial update. Validation already rejected unknown keys; only whitelisted dot-paths are ever $set.
exports.updateMe = BaseController.wrap(async (req, res) => {
  const b = req.body;
  const $set = {};
  if (b.name !== undefined) $set.name = b.name;
  for (const k of PROFILE_FIELDS) if (b.profile && b.profile[k] !== undefined) $set[`profile.${k}`] = b.profile[k];
  for (const k of PREFERENCE_FIELDS) if (b.preferences && b.preferences[k] !== undefined) $set[`preferences.${k}`] = b.preferences[k];
  if (b.ai && b.ai.model !== undefined) $set['ai.model'] = b.ai.model;

  const query = Object.keys($set).length
    ? User.findByIdAndUpdate(req.user.userId, { $set }, { new: true, runValidators: true })
    : User.findById(req.user.userId);
  const user = await query.select('-password');

  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  res.status(200).json({ success: true, user: publicUser(user) });
});

// Change own password. The pre-save hook hashes it; passwordChangedAt invalidates every token issued before now.
exports.changePassword = BaseController.wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user.userId);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }
  if (!(await user.matchPassword(currentPassword))) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect' });
  }
  if (await user.matchPassword(newPassword)) {
    return res.status(400).json({ success: false, message: 'New password must differ from the current password' });
  }

  user.password = newPassword;
  user.passwordChangedAt = new Date();
  await user.save();

  logger.info(`Password changed for user: ${user.username}`);
  res.status(200).json({ success: true, token: sign(user) });
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
