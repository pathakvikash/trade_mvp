const mongoose = require('mongoose');
const Trade = require('../models/Trade');
const User = require('../models/User');
const logger = require('../config/logger');
const BaseController = require('./BaseController');

// Example Low Fee (0.1%)
const FEE_PERCENTAGE = 0.1;

// Wrap the handler so unexpected errors are logged and passed to error middleware
exports.placeTrade = BaseController.wrap(async (req, res) => {
  const { userId, cryptoSymbol, type, amount, priceAtTrade } = req.body;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'User not found' });
    }

    const fee = (amount * priceAtTrade * FEE_PERCENTAGE) / 100;
    const totalCost = amount * priceAtTrade + fee;

    if (type === 'buy' && user.balance < totalCost) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    if (type === 'buy') {
      user.balance -= totalCost; // Deduct total cost (including fee)
    } else if (type === 'sell') {
      user.balance += totalCost - fee; // Add total cost minus fee
    }

    await user.save({ session });

    // Record the trade
    const trade = new Trade({
      userId,
      cryptoSymbol,
      type,
      amount,
      priceAtTrade,
      fee,
    });
    await trade.save({ session });

    await session.commitTransaction();
    session.endSession();

    logger.info(`Trade successful: ${trade}`);
    res.status(201).json({ message: 'Trade successful', trade });
  } catch (error) {
    // Ensure transaction is aborted and session closed before propagating
    try {
      await session.abortTransaction();
    } catch (e) {
      // ignore
    }
    try {
      session.endSession();
    } catch (e) {
      // ignore
    }
    // Rethrow so BaseController.wrap will log and pass to next()
    throw error;
  }
});
