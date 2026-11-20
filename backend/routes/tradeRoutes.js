const express = require('express');
const router = express.Router();
const { placeTrade, listTrades, portfolio } = require('../controllers/tradeController');
const auth = require('../middleware/auth');
const { limitBy } = require('../middleware/rateLimit');
const { placeTradeRules, validate } = require('../middleware/validator');

router.use(auth);
// Orders: 30/min per user (limiter runs after auth so the key is the token's user). Reads are not limited.
router.post('/', limitBy({ limit: 30, windowMs: 60 * 1000 }, (req) => req.user.userId), placeTradeRules(), validate, placeTrade);
router.get('/portfolio', portfolio);
router.get('/', listTrades);

module.exports = router;
