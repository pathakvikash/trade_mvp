const logger = require('../config/logger');

// Logs the full error server-side (query string stripped); the client only ever gets a generic message.
// 4xx from body-parser (bad JSON, 413 too large) keep their status; everything else is a 500.
const errorHandler = (err, req, res, next) => {
  const where = `${req.method} ${String(req.originalUrl).split('?')[0]}`;
  // body-parser errors (entity.parse.failed, entity.too.large, ...): V8's SyntaxError message quotes the request body,
  // which can hold a password, so log only the type and status.
  const bodyErr = err && typeof err.type === 'string' && /^(entity\.|encoding\.|charset\.|request\.|stream\.|parameters\.)/.test(err.type);
  if (bodyErr) logger.warn(`${where} -> body-parser ${err.type} (status ${err.status || 400})`);
  else logger.error(`${where} -> ${err && err.stack ? err.stack : err}`);
  if (res.headersSent) return next(err);

  const status = err && err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).json({
    success: false,
    message: status === 500 ? 'Something went wrong' : 'Invalid request',
  });
};

module.exports = errorHandler;
