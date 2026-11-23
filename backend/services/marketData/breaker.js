// Circuit breaker for one upstream host (merges futuresRest's `br` and the Bybit breaker).
//   const b = breaker('gate', { tripOnNetwork: true });  await b.run(() => axios.get(...));  b.state()
// 418/403/451 open it for max(300 s, Retry-After); 429 for Retry-After or 60 s. While open, exactly one probe goes out
// after the wait and only the probe may close it: a probe that hits a network error/5xx keeps it open, a 4xx closes it
// (host reachable). tripOnNetwork:true (Bybit and every new provider) also opens it on no-response/5xx; Binance passes false.
// Errors thrown while open carry blocked:true so isBlocked()/fallbackable() keep working.
const logger = require('../../config/logger');

const BLOCK_STATUS = new Set([418, 403, 451, 429]);
const BLOCK_MIN_MS = 300e3;
const RATE_LIMIT_MS = 60e3;

const statusOf = (e) => e && e.response && e.response.status;
const isBlocked = (e) => !!e && (e.blocked === true || BLOCK_STATUS.has(statusOf(e)));
// what may be answered from another source: a block, no response, 5xx
const fallbackable = (e) => isBlocked(e) || !e.response || e.response.status >= 500;

// level: logger method for trip/recover lines. Binance keeps 'warn' (the existing wording is relied on); third parties use 'info'
// so a flaky secondary host does not spam warnings.
function breaker(name, { tripOnNetwork = false, level = 'warn' } = {}) {
    const s = { open: false, until: 0, probing: false, lastOkAt: null, lastErrAt: null, lastStatus: null };

    function trip(ms, st) {
        if (!s.open) logger[level](`${name} REST blocked (HTTP ${st || 'no response'}), using fallbacks for ${Math.round(ms / 1000)}s`);
        s.open = true;
        s.until = Date.now() + ms;
    }
    const close = () => { s.open = false; logger[level](`${name} REST recovered`); };

    async function run(fn) {
        let probe = false;
        if (s.open) {
            if (Date.now() < s.until || s.probing) throw Object.assign(new Error(`${name} rest blocked`), { blocked: true, status: 0 });
            s.probing = probe = true; // one caller tests the water; concurrent calls keep short-circuiting
        }
        try {
            const v = await fn();
            // a request that started before the trip must not close it: only the probe can
            if (probe) close();
            s.lastOkAt = Date.now();
            return v;
        } catch (e) {
            const st = statusOf(e);
            s.lastErrAt = Date.now();
            s.lastStatus = st || 0;
            if (BLOCK_STATUS.has(st)) {
                const ra = Number(e.response.headers && e.response.headers['retry-after']);
                const raMs = Number.isFinite(ra) ? ra * 1000 : 0;
                trip(st === 429 ? (raMs || RATE_LIMIT_MS) : Math.max(BLOCK_MIN_MS, raMs), st);
            } else if (probe && !(st && st < 500)) s.until = Date.now() + BLOCK_MIN_MS; // probe hit a network error/5xx: stay open
            else if (probe) close(); // got an answer (e.g. 400): reachable
            else if (tripOnNetwork && (!st || st >= 500)) trip(BLOCK_MIN_MS, st);
            throw e;
        } finally {
            if (probe) s.probing = false;
        }
    }

    const state = () => ({
        state: s.probing ? 'probing' : s.open ? 'open' : 'closed',
        openUntil: s.open ? s.until : null, lastOkAt: s.lastOkAt, lastErrAt: s.lastErrAt, lastStatus: s.lastStatus,
    });
    const reset = () => { Object.assign(s, { open: false, until: 0, probing: false, lastOkAt: null, lastErrAt: null, lastStatus: null }); };
    return { run, state, reset };
}

// require('./breaker') is the factory itself; the helpers and a named export hang off it.
module.exports = Object.assign(breaker, { breaker, statusOf, isBlocked, fallbackable, BLOCK_STATUS });
