const axios = require('axios');
const logger = require('../config/logger');

const POLL_INTERVAL_MS = process.env.MARKET_POLL_INTERVAL_MS
    ? parseInt(process.env.MARKET_POLL_INTERVAL_MS, 10)
    : 30000; // 30s

let interval = null;
let ioNamespace = null;

async function fetchTopMarkets() {
    const url = 'https://api.coingecko.com/api/v3/coins/markets';
    const params = {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 20,
        page: 1,
        sparkline: false,
    };

    const res = await axios.get(url, { params, timeout: 10000 });
    return res.data;
}

function normalizeMarkets(markets) {
    return markets.map((m) => ({
        id: m.id,
        symbol: m.symbol,
        name: m.name,
        image: m.image,
        current_price: m.current_price,
        market_cap: m.market_cap,
        price_change_percentage_24h: m.price_change_percentage_24h,
        last_updated: m.last_updated,
    }));
}

async function pollAndEmit() {
    if (!ioNamespace) return;
    try {
        const markets = await fetchTopMarkets();
        const payload = normalizeMarkets(markets);
        ioNamespace.emit('market:update', payload);
        logger.info(`marketService: emitted ${payload.length} items`);
    } catch (err) {
        logger.error('marketService poll error', err.message || err);
    }
}

module.exports = {
    start: (ioNs) => {
        ioNamespace = ioNs;
        if (interval) clearInterval(interval);
        // immediate first run
        pollAndEmit();
        interval = setInterval(pollAndEmit, POLL_INTERVAL_MS);
        logger.info('marketService started polling CoinGecko');
    },
    stop: () => {
        if (interval) clearInterval(interval);
        interval = null;
        ioNamespace = null;
        logger.info('marketService stopped');
    },
};
