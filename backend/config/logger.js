const winston = require('winston');

// Request secrets must never reach the log files: errors from HTTP clients carry config/request/headers (incl.
// Authorization). morgan only logs method/url/status/ip/UA, never bodies or headers; this covers logger.error(err).
const SENSITIVE = /authorization|password|token|secret|cookie/i;
const DROP = new Set(['config', 'request', 'response', 'headers']);
const MAX_DEPTH = 5;

// Returns a redacted copy (the caller's objects are never mutated); anything deeper than MAX_DEPTH is cut.
function scrub(v, depth) {
  if (!v || typeof v !== 'object') return v;
  if (depth > MAX_DEPTH) return '[truncated]';
  const out = Array.isArray(v) ? [] : {};
  for (const k of Object.keys(v)) {
    if (!Array.isArray(v) && (SENSITIVE.test(k) || DROP.has(k))) continue;
    out[k] = scrub(v[k], depth + 1);
  }
  return out;
}
const redact = winston.format((info) => {
  for (const k of Object.keys(info)) {
    if (SENSITIVE.test(k) || DROP.has(k)) delete info[k];
    else info[k] = scrub(info[k], 1);
  }
  return info;
});

const isTest = process.env.NODE_ENV === 'test';
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(redact(), winston.format.json()),
  // Under jest no log files are created in the cwd, and the console stays quiet.
  transports: isTest
    ? [new winston.transports.Console({ silent: true })]
    : [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
      ],
});

if (process.env.NODE_ENV !== 'production' && !isTest) {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  );
}

// Export the logger
module.exports = logger;
