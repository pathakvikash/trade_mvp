// Which symbols each provider lists, and the contract multiplier (base coin per contract) for Gate/MEXC.
//   const reg = require('./registry')(call)   // call(provider, fn) runs fn behind that provider's breaker
//   reg.lists(p, sym) -> true | false | null   (null = list never loaded: the caller tries the provider anyway)
//   reg.meta(p, sym)  -> {mult} | null          (null = unknown: never guess 1 for a provider that needs a mult)
// The list is cached 1h. A failed refresh keeps the last good list and retries after 60 s (like futuresRest's exchangeInfo).
// A provider with consult:false or no instruments() is never gated by a list.
// The list (~1 MB) is fetched OUTSIDE the provider's breaker with its own 10 s timeout: a slow/failing list must not trip
// the breaker, or the single-contract fallback below (and every capability call) would be blocked too. After the TTL an
// existing list is served stale while a background refresh runs; only a first load is awaited.
const { cached } = require('./cache');

const LIST_TTL_MS = 3600e3;
const RETRY_MS = 60e3;
const LIST_TIMEOUT_MS = 10e3;

module.exports = (call) => {
    const st = new Map(); // provider name -> { map: Map(symbol -> {mult}) | null, at, freshUntil, retryAt, p }
    const stateOf = (name) => { if (!st.has(name)) st.set(name, { map: null, at: null, freshUntil: 0, retryAt: 0, p: null }); return st.get(name); };
    const consults = (p) => typeof p.instruments === 'function' && p.consult !== false;

    function refresh(p, s) {
        s.p = s.p || (async () => {
            try {
                const rows = await p.instruments({ timeout: LIST_TIMEOUT_MS });
                s.map = new Map(rows.map((r) => [r.symbol, { mult: r.mult }]));
                s.at = Date.now();
                s.freshUntil = s.at + LIST_TTL_MS;
            } catch (e) { s.retryAt = Date.now() + RETRY_MS; } finally { s.p = null; }
        })();
        return s.p;
    }

    async function listing(p) {
        const s = stateOf(p.name);
        const now = Date.now();
        if (now >= s.freshUntil && now >= s.retryAt) {
            const r = refresh(p, s);
            if (!s.map) await r;
        }
        return s.map;
    }

    async function lists(p, sym) {
        if (!consults(p)) return null;
        const m = await listing(p);
        return m ? m.has(sym) : null;
    }

    async function meta(p, sym) {
        const m = consults(p) ? await listing(p) : null;
        if (m) return m.get(sym) || null;
        if (typeof p.contract !== 'function') return null;
        // list never loaded: ask for the single contract, cached 1h (failures are evicted by cached(), a null answer is kept)
        return cached(`contract:${p.name}:${sym}`, LIST_TTL_MS, () => call(p, () => p.contract(sym)).then((c) => (c ? { mult: c.mult } : null)))
            .catch(() => null);
    }

    const size = (p) => (stateOf(p.name).map ? stateOf(p.name).map.size : null);
    const at = (p) => stateOf(p.name).at;
    const reset = () => st.clear();
    return { lists, meta, size, at, reset };
};
