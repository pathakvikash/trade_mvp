const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const morgan = require('morgan');
const authRoutes = require('./routes/authRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const { initializeDefaultUsers } = require('./controllers/authController');
const config = require('./config/config');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./config/logger');

const http = require('http');
const { Server } = require('socket.io');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/trades', tradeRoutes);

// Market proxy routes (optional)
const marketRoutes = require('./routes/marketRoutes');
app.use('/api/market', marketRoutes);

// Error Handler
app.use(errorHandler);

// Connect to MongoDB
mongoose
  .connect(config.mongoose.url, config.mongoose.options)
  .then(async () => {
    logger.info('MongoDB connected');
    if (config.env === 'development') {
      await initializeDefaultUsers();
      logger.info('Default users initialized');
    }
  })
  .catch((err) => logger.error(err));

// Create HTTP server and attach socket.io
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

// Market namespace
const marketNs = io.of('/market');
marketNs.on('connection', (socket) => {
  logger.info(`Market socket connected: ${socket.id}`);
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

// Start Server
httpServer.listen(config.port, () => logger.info(`Server running on port ${config.port}`));
