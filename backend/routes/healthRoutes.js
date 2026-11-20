const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// Public platform health check: no auth, no secrets, no versions. 200 even when mongo is down (the process is alive).
router.get('/', (req, res) => {
    res.status(200).json({ ok: true, uptime: Math.round(process.uptime()), mongo: mongoose.connection.readyState === 1 ? 'up' : 'down' });
});

module.exports = router;
