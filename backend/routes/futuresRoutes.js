const express = require('express');
const router = express.Router();
const c = require('../controllers/futuresController');
const auth = require('../middleware/auth');
const { limitBy } = require('../middleware/rateLimit');
const { futuresOrderRules, futuresCloseRules, futuresTpslRules, futuresOrderTpslRules, validate } = require('../middleware/validator');

router.use(auth);
// Writes: 30/min per user (after auth, so the key is the token's user). Reads are not limited (the UI polls every 3s).
const writeLimit = limitBy({ limit: 30, windowMs: 60 * 1000 }, (req) => 'fut:' + req.user.userId);

router.get('/config', c.config);
router.get('/positions', c.listPositions);
router.get('/orders', c.listOrders);
router.post('/orders', writeLimit, futuresOrderRules(), validate, c.placeOrder);
router.patch('/orders/:id', writeLimit, futuresOrderTpslRules(), validate, c.editOrderTpsl);
router.delete('/orders/:id', writeLimit, c.cancelOrder);
router.post('/positions/:id/close', writeLimit, futuresCloseRules(), validate, c.closePosition);
router.patch('/positions/:id', writeLimit, futuresTpslRules(), validate, c.editPosition);

module.exports = router;
