const crypto = require('crypto');

// Key-sorted JSON so the same spec always hashes the same. Shared by strategies (specHash) and bots (acceptHash).
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const hashOf = (v) => crypto.createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');

// What the user approves is exactly this: the spec plus every parameter that changes what the bot may do.
// Recomputed from the bot's own fields (never trusted from storage) at accept and start.
const botHash = (b) => hashOf({
  specHash: hashOf(b.spec), symbol: b.symbol, interval: b.interval, sizeUsd: b.sizeUsd, leverage: b.leverage,
  limits: { ...b.limits, symbols: [...(b.limits.symbols || [])].sort() },
});

module.exports = { canon, hashOf, botHash };
