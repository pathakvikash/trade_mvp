// Promise cache shared by the market-data gateway (moved verbatim from futuresRest.js) plus a last-good store
// so view-only features (stocks) can serve stale data when the upstream fails.
// ponytail: per-process, keyed by string; failures are evicted, capped at MAX_CACHE entries (oldest dropped).
const MAX_CACHE = 500;
const cache = new Map();

// Stores the promise, so concurrent callers share one request.
function cached(key, ttlMs, fn, store = cache, max = MAX_CACHE) {
    const c = store.get(key);
    if (c && c.exp > Date.now()) return c.p;
    const p = fn();
    for (const [k, v] of store) if (v.exp <= Date.now()) store.delete(k);
    if (store.size >= max) store.delete(store.keys().next().value);
    store.set(key, { p, exp: Date.now() + ttlMs });
    p.catch(() => { if (store.get(key)?.p === p) store.delete(key); });
    return p;
}

// key -> { value, at }. Callers write with remember(key, value) after a good answer and read lastGood.get(key) on failure.
const LAST_MAX = 200;
const lastGood = new Map();
function remember(key, value) {
    lastGood.delete(key);
    if (lastGood.size >= LAST_MAX) lastGood.delete(lastGood.keys().next().value);
    lastGood.set(key, { value, at: Date.now() });
    return value;
}

const clear = () => { cache.clear(); lastGood.clear(); };

module.exports = { cached, lastGood, remember, clear, _cache: cache };
