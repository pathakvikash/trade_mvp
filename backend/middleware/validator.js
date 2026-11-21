const { body, validationResult } = require('express-validator');
const { AI_MODELS } = require('../services/aiService');
const { PROVIDER_IDS, MODEL_ID_RE, checkBaseUrl, checkLocalUrl } = require('../services/aiProviders');

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

// currentPassword is optional here only so Google-created accounts (passwordSet === false) can set a first password;
// the controller demands it for everyone else.
const passwordChangeRules = () => [
  body('currentPassword').optional().isString().isLength({ min: 1, max: 128 }).withMessage('Current password is required'),
  passwordRule('newPassword'),
];

// Only these keys may be set through PATCH /api/auth/me; anything else (role, balance, email, username, password...) is a 422.
const ROOT_KEYS = ['name', 'profile', 'preferences', 'ai'];
const PROFILE_KEYS = ['bio', 'country', 'timezone'];
const PREFERENCE_KEYS = ['defaultSymbol', 'defaultTimeframe', 'alertToasts', 'alertSound', 'landingPage', 'compactTables', 'tickerBar', 'tickerSpeed', 'fundingCountdown', 'reduceMotion', 'timeFormat', 'confirmClose', 'defaultLeverage', 'defaultOrderType'];
const AI_KEYS = ['provider', 'model', 'systemPrompt', 'temperature', 'length', 'includePortfolio', 'providers'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const PREF_ENUMS = {
  landingPage: ['dashboard', 'trade', 'market', 'portfolio', 'derivatives', 'liquidation'],
  tickerSpeed: ['slow', 'normal', 'fast'],
  timeFormat: ['auto', '12h', '24h'],
  defaultOrderType: ['market', 'limit'],
};
const PREF_BOOLS = ['compactTables', 'tickerBar', 'fundingCountdown', 'reduceMotion', 'confirmClose'];
// includes() on the raw value, not isIn(): isIn stringifies, so ['trade'] would pass.
const oneOf = (list) => (v) => list.includes(v);
const isBool = (v) => typeof v === 'boolean';
const isLeverage = (v) => Number.isInteger(v) && v >= 1 && v <= 50;

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
  ...Object.entries(PREF_ENUMS).map(([k, list]) => body(`preferences.${k}`).optional().custom(oneOf(list)).withMessage(`${k} must be one of ${list.join(', ')}`)),
  ...PREF_BOOLS.map((k) => body(`preferences.${k}`).optional().custom(isBool).withMessage(`${k} must be true or false`)),
  body('preferences.defaultLeverage').optional().custom(isLeverage).withMessage('defaultLeverage must be an integer from 1 to 50'),
  body('ai').optional().custom(plainObjectWithKeys(AI_KEYS)),
  body('ai.model').optional({ values: 'undefined' }).custom((v) => v === null || AI_MODELS.some((m) => m.id === v)).withMessage(`AI model must be null or one of ${AI_MODELS.map((m) => m.id).join(', ')}`),
  body('ai.provider').optional().custom(oneOf(['default', ...PROVIDER_IDS])).withMessage('Unknown AI provider'),
  body('ai.systemPrompt').optional().isString().trim().isLength({ max: 2000 }).withMessage('System prompt must be at most 2000 characters'),
  body('ai.temperature').optional({ values: 'undefined' }).custom((v) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)).withMessage('Temperature must be a number from 0 to 1, or null'),
  body('ai.length').optional().custom(oneOf(['short', 'normal', 'detailed'])).withMessage('Length must be short, normal or detailed'),
  body('ai.includePortfolio').optional().custom(isBool).withMessage('includePortfolio must be true or false'),
  body('ai.providers').optional().custom(plainObjectWithKeys(PROVIDER_IDS)),
  ...PROVIDER_IDS.flatMap((id) => [
    body(`ai.providers.${id}`).optional().custom(plainObjectWithKeys(id === 'custom' || id === 'lmstudio' ? ['model', 'baseUrl'] : ['model'])),
    body(`ai.providers.${id}.model`).optional().custom((v) => v === '' || (typeof v === 'string' && MODEL_ID_RE.test(v))).withMessage('Model id may use letters, digits and . _ : / @ - (max 100 characters)'),
  ]),
  body('ai.providers.custom.baseUrl').optional().custom((v) => {
    if (v === '') return true;
    if (typeof v !== 'string' || v.length > 300) return false;
    try { checkBaseUrl(v); return true; } catch (e) { return false; }
  }).withMessage('Base URL must be a public https URL without credentials'),
  body('ai.providers.lmstudio.baseUrl').optional().custom((v) => {
    if (v === '') return true; // '' = server default (LMSTUDIO_BASE_URL or http://localhost:1234/v1)
    if (typeof v !== 'string' || v.length > 300) return false;
    try { checkLocalUrl(v); return true; } catch (e) { return false; }
  }).withMessage('LM Studio base URL must be http(s)://localhost, 127.0.0.1 or [::1] with an optional port and path (local models are off in production unless ALLOW_LOCAL_LLM=true)'),
];

const avatarRules = () => [
  body().custom(plainObjectWithKeys(['avatar'])),
  body('avatar').isString().withMessage('avatar must be a string'), // format and size: controller.checkAvatar
];

const deleteAccountRules = () => [
  body().custom(plainObjectWithKeys(['confirmEmail'])),
  body('confirmEmail').isString().isLength({ min: 1, max: 254 }).withMessage('Type your account email to confirm'),
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
  body('leverage').custom(isLeverage).withMessage('leverage must be an integer from 1 to 50'),
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

// PATCH /positions/:id: tp/sl (null clears) and/or a new leverage, applied together or not at all.
const futuresTpslRules = () => [
  body().custom(plainObjectWithKeys(['tp', 'sl', 'leverage'])),
  body().custom((v) => v && ('tp' in v || 'sl' in v || 'leverage' in v)).withMessage('Provide tp, sl and/or leverage'),
  tpslField('tp'),
  tpslField('sl'),
  body('leverage').optional({ values: 'undefined' }).custom(isLeverage).withMessage('leverage must be an integer from 1 to 50'),
];

// PATCH /orders/:id: tp/sl only (price, size and leverage change the reservation: cancel and re-place instead).
const futuresOrderTpslRules = () => [
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
  avatarRules,
  deleteAccountRules,
  googleRules,
  placeTradeRules,
  futuresOrderRules,
  futuresCloseRules,
  futuresTpslRules,
  futuresOrderTpslRules,
  validate,
};
