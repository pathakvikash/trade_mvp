// In-memory sliding-window limiter shared by auth, trades, alerts and AI routes.
// ponytail: single process, per-instance counters; use Redis if this ever runs multi-instance.
// Keys come from req.ip, which honours app.set('trust proxy') (env TRUST_PROXY, applied in server.js).
const net = require('net');
const logger = require('../config/logger');

const MAX_KEYS = 5000; // bound memory: when full, the least recently active key is evicted (O(1), Map insertion order)

// Returns check(key, res): true when it already sent the 429 (caller must stop), false when the hit was counted.
function createLimiter({ limit, windowMs }) {
    const hits = new Map(); // key -> timestamps (ms) inside the window
    return (key, res) => {
        const now = Date.now();
        if (hits.size >= MAX_KEYS) {
            hits.delete(hits.keys().next().value);
        }
        const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
        if (arr.length >= limit) {
            hits.delete(key); // re-insert below so recently active keys are evicted last
            hits.set(key, arr);
            res.set('Retry-After', String(Math.max(1, Math.ceil((windowMs - (now - arr[0])) / 1000))));
            res.status(429).json({ error: 'rate_limited' });
            return true;
        }
        arr.push(now);
        hits.delete(key);
        hits.set(key, arr);
        return false;
    };
}

// Client key: IPv4 as is, IPv4-mapped IPv6 as the IPv4, other IPv6 as its /64 (one subscriber can rotate through a
// whole /64, so per-address keys would be no limit at all). No IP at all shares one fixed key, logged once.
let warnedNoIp = false;
function ipKey(ip) {
    if (!ip || typeof ip !== 'string') {
        if (!warnedNoIp) { warnedNoIp = true; logger.warn('rateLimit: request without an IP; all such requests share one bucket'); }
        return 'no-ip';
    }
    let a = ip.split('%')[0].toLowerCase();
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) a = mapped[1];
    if (net.isIPv6(a) === false) return a;
    const v4 = a.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // embedded IPv4 tail -> two hextets
    if (v4) {
        const o = v4[2].split('.').map(Number);
        a = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    }
    const [head, tail] = a.split('::');
    const h = head ? head.split(':') : [];
    const t = tail === undefined ? [] : tail ? tail.split(':') : [];
    const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return `${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
}

// Express middleware form. keyFn(req) -> string; default is the normalised client IP.
const limitBy = (opts, keyFn = (req) => ipKey(req.ip)) => {
    const check = createLimiter(opts);
    return (req, res, next) => (check(String(keyFn(req)), res) ? undefined : next());
};

module.exports = { createLimiter, limitBy, ipKey };
