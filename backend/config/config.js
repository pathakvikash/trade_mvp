// Load environment variables and validation library
const dotenv = require('dotenv');
const Joi = require('joi');

dotenv.config();

// Values copied from examples/docs must never sign tokens.
const PLACEHOLDER = /change.?me|placeholder|replace.?me|your.?(jwt.?)?secret|example|x{6,}|^(secret|password|jwtsecret)/i;

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string()
      .valid('production', 'development', 'test')
      .required(),
    // .empty('') everywhere below: a set-but-empty var (e.g. copied from .env.example) means "use the default".
    PORT: Joi.number().empty('').default(4000),
    MONGO_URI: Joi.string().required().description('Mongo DB url'),
    JWT_SECRET: Joi.string()
      .min(32)
      .pattern(PLACEHOLDER, { invert: true, name: 'placeholder' })
      .required()
      .description('JWT secret key (>= 32 chars, not a placeholder)'),
    // Required in production (no localhost default); the wildcard check is below.
    CORS_ORIGINS: Joi.string().empty('').when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.string().default('http://localhost:3000,http://localhost:3001') }),
    // Bind address; default depends on NODE_ENV (see below).
    HOST: Joi.string().empty(''),
    // Reverse-proxy hops to trust for req.ip: 0/false (default), a hop count, or true (trust all; spoofable).
    TRUST_PROXY: Joi.string().empty('').pattern(/^(true|false|\d+)$/i).default('0'),
    // Log files (error.log/combined.log). Default: on outside production, off in production (console only).
    LOG_TO_FILES: Joi.boolean().empty(''),
  })
  .unknown();
const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: 'key' } })
  .validate(process.env);

if (error) {
  // never echo the offending value: Joi's own message quotes it, and JWT_SECRET/MONGO_URI are secrets
  throw new Error(`Config validation error: ${error.details.map((d) => `${d.path.join('.')} (${d.type})`).join(', ')}`);
}

const isProd = envVars.NODE_ENV === 'production';
const corsOrigins = envVars.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

// Production safety: fail fast (key names only, never values). JWT_SECRET length/placeholder is already enforced above.
const problems = [];
if (isProd) {
  if (!corsOrigins.length) problems.push('CORS_ORIGINS must list at least one origin in production');
  if (corsOrigins.some((o) => o.includes('*'))) problems.push('CORS_ORIGINS must not contain a wildcard in production');
  if (process.env.SEED_DEMO_USERS === 'true') problems.push('SEED_DEMO_USERS=true is refused in production (demo accounts never run there)');
}
if (problems.length) throw new Error(`Config validation error: ${problems.join('; ')}`);

const tp = envVars.TRUST_PROXY.toLowerCase();
const warnings = [];
if (isProd && !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
  warnings.push('ANTHROPIC_API_KEY is not set: AI features are DISABLED in production (the dev-only CLI provider never runs here)');
}

module.exports = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  host: envVars.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
  trustProxy: tp === 'true' ? true : tp === 'false' ? false : Number(tp),
  logToFiles: envVars.LOG_TO_FILES === undefined ? !isProd : envVars.LOG_TO_FILES,
  warnings, // startup warnings; server.js logs them (config cannot require the logger, which requires config)
  mongoose: {
    url: envVars.MONGO_URI,
    options: {},
  },
  jwt: {
    secret: envVars.JWT_SECRET,
  },
  corsOrigins,
};
