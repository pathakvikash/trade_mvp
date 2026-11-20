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
    PORT: Joi.number().default(4000),
    MONGO_URI: Joi.string().required().description('Mongo DB url'),
    JWT_SECRET: Joi.string()
      .min(32)
      .pattern(PLACEHOLDER, { invert: true, name: 'placeholder' })
      .required()
      .description('JWT secret key (>= 32 chars, not a placeholder)'),
    CORS_ORIGINS: Joi.string().default('http://localhost:3000,http://localhost:3001'),
  })
  .unknown();
const { value: envVars, error } = envVarsSchema
  .prefs({ errors: { label: 'key' } })
  .validate(process.env);

if (error) {
  // never echo the offending value: Joi's own message quotes it, and JWT_SECRET/MONGO_URI are secrets
  throw new Error(`Config validation error: ${error.details.map((d) => `${d.path.join('.')} (${d.type})`).join(', ')}`);
}

module.exports = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: envVars.MONGO_URI,
    options: {},
  },
  jwt: {
    secret: envVars.JWT_SECRET,
  },
  corsOrigins: envVars.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
};
