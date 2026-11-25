// GET /api/news?limit=30&category=all|crypto|india : public, headlines + link-out only (see services/news.js)
const express = require('express');
const router = express.Router();
const news = require('../services/news');
const { limitBy } = require('../middleware/rateLimit');

router.use(limitBy({ limit: 60, windowMs: 60e3 })); // per IP

router.get('/', async (req, res) => {
    const category = req.query.category === undefined ? 'all' : String(req.query.category);
    if (!news.CATEGORIES.includes(category)) return res.status(400).json({ error: 'invalid category' });
    const parsed = parseInt(req.query.limit, 10);
    const limit = Math.min(50, Math.max(1, Number.isFinite(parsed) ? parsed : 30));
    try {
        const d = await news.headlines({ limit, category });
        res.set('X-Data-Source', 'rss').json({ ...d, disclaimer: news.DISCLAIMER });
    } catch {
        res.status(502).json({ error: 'News unavailable' });
    }
});

module.exports = router;
