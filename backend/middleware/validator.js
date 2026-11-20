const { body, validationResult } = require('express-validator');
const { AI_MODELS } = require('../services/aiService');

// isString() first on every field: it rejects objects/arrays (e.g. {"$gt":""}) before they reach a Mongo query.
const email = body('email').isString().trim().isLength({ max: 254 }).isEmail().withMessage('Please provide a valid email');

// 72: bcrypt ignores anything past 72 bytes, so a longer limit would be a false promise.
const passwordRule = (field) => body(field).isString().isLength({ min: 8, max: 72 }).withMessage('Password must be 8-72 characters long');

// Login only needs "non-empty": password rules must not lock out accounts created under older rules.
const loginRules = () => [
  email,
  body('password').isString().isLength({ min: 1, max: 128 }).withMessage('Password is required'),
];

const registerRules = () => [
  body('username').isString().matches(/^[a-zA-Z0-9_]{3,30}$/).withMessage('Username must be 3-30 characters: letters, numbers, underscore'),
  body('name').isString().trim().isLength({ min: 1, max: 60 }).withMessage('Name must be 1-60 characters'),
  email,
  passwordRule('password'),
];

// Google ID token (a JWT, a few hundred chars). The bounds only keep junk out before the real check in the controller.
const googleRules = () => [body('credential').isString().isLength({ min: 20, max: 4096 }).withMessage('Google credential is required')];

const passwordChangeRules = () => [
  body('currentPassword').isString().isLength({ min: 1, max: 128 }).withMessage('Current password is required'),
  passwordRule('newPassword'),
];

// Only these keys may be set through PATCH /api/auth/me; anything else (role, balance, email, username, password...) is a 422.
const ROOT_KEYS = ['name', 'profile', 'preferences', 'ai'];
const PROFILE_KEYS = ['bio', 'country', 'timezone'];
const PREFERENCE_KEYS = ['defaultSymbol', 'defaultTimeframe', 'alertToasts', 'alertSound'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

const plainObjectWithKeys = (keys) => (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Must be an object');
  const extra = Object.keys(v).find((k) => !keys.includes(k));
  if (extra) throw new Error(`Unknown field: ${extra}`);
  return true;
};

const updateMeRules = () => [
  body().custom(plainObjectWithKeys(ROOT_KEYS)),
  body('name').optional().isString().trim().isLength({ min: 2, max: 60 }).withMessage('Name must be 2-60 characters'),
  body('profile').optional().custom(plainObjectWithKeys(PROFILE_KEYS)),
  body('profile.bio').optional().isString().trim().isLength({ max: 160 }).withMessage('Bio must be at most 160 characters'),
  body('profile.country').optional().isString().trim().isLength({ max: 56 }).withMessage('Country must be at most 56 characters'),
  body('profile.timezone').optional().isString().trim().isLength({ max: 64 }).withMessage('Timezone must be at most 64 characters'),
  body('preferences').optional().custom(plainObjectWithKeys(PREFERENCE_KEYS)),
  body('preferences.defaultSymbol').optional().isString().matches(/^[A-Z0-9]{2,20}$/).withMessage('Default symbol must be 2-20 uppercase letters or digits'),
  body('preferences.defaultTimeframe').optional().isIn(TIMEFRAMES).withMessage(`Default timeframe must be one of ${TIMEFRAMES.join(', ')}`),
  body('preferences.alertToasts').optional().custom((v) => typeof v === 'boolean').withMessage('alertToasts must be true or false'),
  body('preferences.alertSound').optional().custom((v) => typeof v === 'boolean').withMessage('alertSound must be true or false'),
  body('ai').optional().custom(plainObjectWithKeys(['model'])),
  body('ai.model').optional({ values: 'undefined' }).custom((v) => v === null || AI_MODELS.some((m) => m.id === v)).withMessage(`AI model must be null or one of ${AI_MODELS.map((m) => m.id).join(', ')}`),
];

// POST /api/trades extras: orderType is 'market' (default) or 'limit'; a limit order needs limitPrice > 0.
// The rest of the body (type, amount, symbol) is checked by the controller.
const placeTradeRules = () => [
  body('orderType').optional().custom((v) => v === 'market' || v === 'limit').withMessage("orderType must be 'market' or 'limit'"),
  body('limitPrice')
    .if(body('orderType').equals('limit'))
    .custom((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e9)
    .withMessage('limitPrice must be a number greater than 0'),
];

// ---- /api/futures (spec docs/phase2-leverage.md section 5). Strict JSON types: numbers must be numbers, unknown keys 422.
const isPrice = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1e9;
const isSize = (v) => isPrice(v) && Math.round(v * 1e8) / 1e8 > 0; // round8 must stay > 0
const tpslField = (f) => body(f).optional({ values: 'undefined' }).custom((v) => v === null || isPrice(v)).withMessage(`${f} must be a price greater than 0 or null`);
const optionalObjectWithKeys = (keys) => (v) => v === undefined || plainObjectWithKeys(keys)(v);

const futuresOrderRules = () => [
  body().custom(plainObjectWithKeys(['symbol', 'side', 'type', 'size', 'leverage', 'limitPrice', 'tp', 'sl'])),
  body('symbol').isString().matches(/^[A-Z0-9]{2,20}$/).withMessage('Invalid symbol'),
  body('side').isIn(['long', 'short']).withMessage("side must be 'long' or 'short'"),
  body('type').isIn(['market', 'limit']).withMessage("type must be 'market' or 'limit'"),
  body('size').custom(isSize).withMessage('size must be a number greater than 0'),
  body('leverage').custom((v) => Number.isInteger(v) && v >= 1 && v <= 50).withMessage('leverage must be an integer from 1 to 50'),
  body('limitPrice')
    .custom((v, { req }) => (req.body.type === 'limit' ? isPrice(v) : v === undefined))
    .withMessage('limitPrice is required (a number greater than 0) for limit orders and not allowed for market orders'),
  tpslField('tp'),
  tpslField('sl'),
];

const futuresCloseRules = () => [
  body().custom(optionalObjectWithKeys(['size'])),
  body('size').optional({ values: 'undefined' }).custom(isSize).withMessage('size must be a number greater than 0'),
];

const futuresTpslRules = () => [
  body().custom(plainObjectWithKeys(['tp', 'sl'])),
  body().custom((v) => v && ('tp' in v || 'sl' in v)).withMessage('Provide tp and/or sl'),
  tpslField('tp'),
  tpslField('sl'),
];

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }
  const extractedErrors = errors.array().map((err) => ({ [err.path]: err.msg }));

  return res.status(422).json({
    success: false,
    message: errors.array()[0].msg,
    errors: extractedErrors,
  });
};

module.exports = {
  loginRules,
  registerRules,
  passwordChangeRules,
  updateMeRules,
  googleRules,
  placeTradeRules,
  futuresOrderRules,
  futuresCloseRules,
  futuresTpslRules,
  validate,
};
