const express = require('express');
const router = express.Router();
const { placeTrade } = require('../controllers/tradeController');

router.post('/', placeTrade);

module.exports = router;
