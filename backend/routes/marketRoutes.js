const express = require('express');
const axios = require('axios');
const router = express.Router();

// Proxy for historical market_chart data
router.get('/market_chart/:id', async (req, res) => {
    const { id } = req.params;
    const { days = '1' } = req.query;
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
            id
        )}/market_chart`;
        const response = await axios.get(url, {
            params: { vs_currency: 'usd', days },
            timeout: 10000,
        });
        res.json(response.data);
    } catch (err) {
        res.status(502).json({ message: 'Failed to fetch market chart', error: err.message });
    }
});

// Proxy for OHLC data
router.get('/ohlc/:id', async (req, res) => {
    const { id } = req.params;
    const { days = '1' } = req.query;
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
            id
        )}/ohlc`;
        const response = await axios.get(url, {
            params: { vs_currency: 'usd', days },
            timeout: 10000,
        });
        res.json(response.data);
    } catch (err) {
        res.status(502).json({ message: 'Failed to fetch OHLC', error: err.message });
    }
});

module.exports = router;
