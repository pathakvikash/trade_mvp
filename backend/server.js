const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const morgan = require('morgan');
const authRoutes = require('./routes/authRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const { initializeDefaultUsers, warnAboutAdmins, lockLegacyAccounts } = require('./controllers/authController');
const config = require('./config/config');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./config/logger');

const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Behind a reverse proxy req.ip must come from X-Forwarded-For or every client shares one rate-limit bucket. Set before
// any limiter/middleware. Default 0 (off). Socket.IO has no IP-keyed limits (its origin check uses headers only).
app.set('trust proxy', config.trustProxy);
config.warnings.forEach((w) => logger.warn(w));

// Middleware
// API only (no HTML served): helmet defaults; CORP cross-origin so the SPA on another localhost port can read responses.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
// Avatar upload only: a 150KB image is ~200KB of base64. Must come before the global parser, which would 413 it.
// ponytail: parsed before auth, so an unauthenticated caller can make us parse up to 256kb on this one path.
app.use('/api/auth/me/avatar', express.json({ limit: '256kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['X-Data-Source'] })); // SPA reads where market data came from
// morgan 'combined' logs ip/method/url/status/referrer/UA only: never request bodies or the Authorization header.
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Routes
app.use('/api/health', require('./routes/healthRoutes'));
app.use('/api/auth', authRoutes);
app.use('/api/trades', tradeRoutes);
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/futures', require('./routes/futuresRoutes'));

// Market proxy routes (optional)
const marketRoutes = require('./routes/marketRoutes');
app.use('/api/market', marketRoutes);

app.use('/api/news', require('./routes/newsRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));
app.use('/api/strategies', require('./middleware/auth'), require('./routes/strategyRoutes'));
app.use('/api/bots', require('./middleware/auth'), require('./routes/botRoutes'));

// Error Handler
app.use(errorHandler);

// Connect to MongoDB
mongoose
  .connect(config.mongoose.url, config.mongoose.options)
  .then(async () => {
    logger.info('MongoDB connected');
    await lockLegacyAccounts();
    await initializeDefaultUsers(); // no-op unless SEED_DEMO_USERS=true
    await warnAboutAdmins();
  })
  .catch((err) => {
    logger.error(err);
    // A server that never reached Mongo would report healthy but fail every request: exit so the supervisor restarts it.
    if (process.env.NODE_ENV !== 'test') process.exit(1);
  });

// Create HTTP server and attach socket.io
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: config.corsOrigins,
  },
  // `cors` does not cover websocket upgrades: reject browser origins that are not allowed (non-browser clients send none).
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    cb(null, !origin || config.corsOrigins.includes(origin));
  },
});

// Market namespace
const marketNs = io.of('/market');
marketNs.on('connection', (socket) => {
  logger.info(`Market socket connected: ${socket.id}`);
  // send the latest snapshot now instead of making the client wait for the next poll
  const last = require('./services/marketService').getLast();
  if (last) socket.emit('market:update', last);
  socket.on('disconnect', (reason) => {
    logger.info(`Market socket disconnected: ${socket.id} (${reason})`);
  });
});

// Start market poller service
try {
  const marketService = require('./services/marketService');
  marketService.start(marketNs);
} catch (err) {
  logger.error('Failed to start market service', err);
}

// Futures namespace (Binance USDS-M liquidations, klines, book, mark price)
const futuresNs = io.of('/futures');
const futuresService = require('./services/futuresService');
try {
  futuresService.start(futuresNs);
} catch (err) {
  logger.error('Failed to start futures service', err);
}

// Alert evaluator + /alerts socket namespace (JWT in handshake.auth.token)
const alertService = require('./services/alertService');
try {
  alertService.start(io);
} catch (err) {
  logger.error('Failed to start alert service', err);
}

// Limit-order matcher (fills open orders when the mark price crosses their limit)
const orderMatcher = require('./services/orderMatcher');
try {
  orderMatcher.start();
} catch (err) {
  logger.error('Failed to start order matcher', err);
}

// Futures risk engine (liquidation / SL / TP / limit entries; first pass runs ledger.recoverAll() for crashed ops, only for
// ops older than 15s). DEPLOYS MUST BE STOP-THEN-START: let the old process drain (SIGTERM waits up to 5s for in-flight
// settles) before the new one boots; two live engines would race on recovery and could roll back an op mid-flight.
const riskEngine = require('./services/riskEngine');
try {
  riskEngine.start();
} catch (err) {
  logger.error('Failed to start risk engine', err);
}

// Bot engine (paper bots driven by accepted strategy specs; places orders only through services/futuresOrders).
// Off when BOTS_ENABLED=false; default on in development/test, off in production until the owner turns it on.
const botEngine = require('./services/bot/botEngine');
try {
  botEngine.start();
} catch (err) {
  logger.error('Failed to start bot engine', err);
}

// Stop services on shutdown
const shutdown = async () => {
  try {
    const matcherDone = orderMatcher.stop();
    const riskDone = riskEngine.stop();
    const botDone = botEngine.stop();
    require('./services/marketService').stop();
    alertService.stop();
    futuresService.stop();
    const timeout = new Promise((r) => setTimeout(r, 5000).unref()); // let an in-flight settle finish, but never hang
    await Promise.race([Promise.all([matcherDone, riskDone, botDone]), timeout]);
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start Server
// HOST default: loopback in development, 0.0.0.0 in production (see config).
const host = config.host;
httpServer.listen(config.port, host, () => logger.info(`Server running on ${host}:${config.port}`));
