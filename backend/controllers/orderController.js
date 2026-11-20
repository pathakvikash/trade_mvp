const mongoose = require('mongoose');
const Order = require('../models/Order');
const logger = require('../config/logger');
const BaseController = require('./BaseController');
const { releaseReservation, userIdOf } = require('../services/tradeFill');

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

// GET /api/orders -> { orders: open orders (newest first), closed: last 20 filled/cancelled/rejected }
exports.listOrders = BaseController.wrap(async (req, res) => {
  const userId = userIdOf(req);
  if (!userId) return bad(res, 'Invalid token', 401);
  const [orders, closed] = await Promise.all([
    Order.find({ userId, status: 'open' }).sort({ createdAt: -1 }).lean(),
    Order.find({ userId, status: { $ne: 'open' } }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  res.json({ success: true, orders, closed });
});

// DELETE /api/orders/:id  Cancels an own open order. The status flip is conditional (open -> cancelled), so it
// wins at most once even against the matcher; only the winner releases the reservation.
// 404: no such order of yours (another user's id looks the same), 409: it is no longer open.
exports.cancelOrder = BaseController.wrap(async (req, res) => {
  const userId = userIdOf(req);
  if (!userId) return bad(res, 'Invalid token', 401);
  const id = req.params.id;
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/i.test(id) || !mongoose.isValidObjectId(id)) return bad(res, 'Order not found', 404);

  const order = await Order.findOneAndUpdate({ _id: id, userId, status: 'open' }, { $set: { status: 'cancelled' } }, { new: true });
  if (!order) {
    const exists = await Order.findOne({ _id: id, userId }).select('status').lean();
    return exists ? bad(res, `Order is already ${exists.status}`, 409) : bad(res, 'Order not found', 404);
  }
  let user;
  try {
    user = await releaseReservation(order);
  } catch (e) {
    // could not release: put the order back so the reservation is not lost, and let the user retry
    await Order.updateOne({ _id: id, status: 'cancelled' }, { $set: { status: 'open' } }).catch(() => {});
    logger.error(`order: release failed on cancel ${id}: ${e.message}`);
    throw e;
  }
  res.json({ success: true, order, balance: user ? Math.round(user.balance * 100) / 100 : null });
});
