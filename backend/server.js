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

// ponytail: 'trust proxy' is deliberately NOT set, so req.ip (used by the login/register rate limits) is the socket
// peer. Behind a reverse proxy that is the proxy's IP for everyone; set app.set('trust proxy', <hops>) there.

// Middleware
// API only (no HTML served): helmet defaults; CORP cross-origin so the SPA on another localhost port can read responses.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '100kb' }));
app.use(cors({ origin: config.corsOrigins }));
// morgan 'combined' logs ip/method/url/status/referrer/UA only: never request bodies or the Authorization header.
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/trades', tradeRoutes);

// Market proxy routes (optional)
const marketRoutes = require('./routes/marketRoutes');
app.use('/api/market', marketRoutes);

app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/alerts', require('./routes/alertRoutes'));

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
  .catch((err) => logger.error(err));

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

// Stop services on shutdown
const shutdown = () => {
  try {
    require('./services/marketService').stop();
    alertService.stop();
    futuresService.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start Server
// Loopback only by default: set HOST=0.0.0.0 only behind auth hardening.
const host = process.env.HOST || '127.0.0.1';
httpServer.listen(config.port, host, () => logger.info(`Server running on ${host}:${config.port}`));
