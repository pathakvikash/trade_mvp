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

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/trades', tradeRoutes);

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

// Start Server
app.listen(config.port, () => logger.info(`Server running on port ${config.port}`));
