// Cleaning for third-party rows before the controller tags and returns them. Empty after cleaning = "no data" (next provider).

// No response/status on purpose: breaker.fallbackable() treats it as fallbackable, so the chain moves on.
class StaleError extends Error {
    constructor(msg) { super(msg); this.name = 'StaleError'; this.stale = true; }
}

// rows: {time(s), open, high, low, close, volume}. ivMs = interval length, now = ms.
function candles(rows, ivMs, now, { allowStale = false } = {}) {
    const byTime = new Map();
    for (const r of rows) {
        const { open: o, high: h, low: l, close: c } = r;
        const t = Number(r.time);
        if (![o, h, l, c, t].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
        if (t * 1000 > now + ivMs) continue; // future row
        byTime.set(t, { // later duplicate wins
            time: t, open: o, high: Math.max(h, o, c), low: Math.min(l, o, c), close: c,
            volume: Number.isFinite(r.volume) && r.volume >= 0 ? r.volume : 0,
        });
    }
    const out = [...byTime.values()].sort((a, b) => a.time - b.time);
    if (out.length && !allowStale && out[out.length - 1].time * 1000 < now - 3 * ivMs) {
        throw new StaleError(`stale candles (last ${new Date(out[out.length - 1].time * 1000).toISOString()})`);
    }
    return out;
}

// rows: {ts(ms), [key]}. Keeps finite >0 values (key 'rate' = funding: any finite), sorted, one row per ts (last wins).
function series(rows, key, { signed = key === 'rate' } = {}) {
    const byTs = new Map();
    for (const r of rows) {
        const v = r[key];
        if (!Number.isFinite(r.ts) || !Number.isFinite(v) || (!signed && v <= 0)) continue;
        byTs.set(r.ts, r);
    }
    return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

module.exports = { candles, series, StaleError };
