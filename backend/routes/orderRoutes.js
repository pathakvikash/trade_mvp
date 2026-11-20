const express = require('express');
const router = express.Router();
const { listOrders, cancelOrder } = require('../controllers/orderController');
const auth = require('../middleware/auth');
const { limitBy } = require('../middleware/rateLimit');

router.use(auth);
router.get('/', listOrders);
router.delete('/:id', limitBy({ limit: 60, windowMs: 60 * 1000 }, (req) => req.user.userId), cancelOrder);

module.exports = router;
