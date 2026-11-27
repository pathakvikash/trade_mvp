// Orrery service auth: HS256 JWT verification with Node crypto only (no jsonwebtoken here: the alg is pinned by hand).
// Env is read per call so tests and a restarted dyno see changes. Secret unset = integration off (callers answer 503/404).
const crypto = require('crypto');

const SKEW_S = 30;
const SSO_MAX_LIFETIME_S = 60;

const settings = () => ({
    secret: process.env.ORRERY_APP_SECRET || '',
    iss: process.env.ORRERY_ISSUER || 'orrery',
    aud: process.env.ORRERY_APP_ID || 'trade',
});
const enabled = () => settings().secret.length > 0;

const part = (s) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch { return null; } };

// Returns the claims, or throws Error(reason). purpose: 'sso' demands that purpose; omitted demands NO purpose, so an
// SSO handoff token can never call the MCP endpoint and vice versa.
function verifyJwt(token, { purpose, nowMs = Date.now() } = {}) {
    const { secret, iss, aud } = settings();
    if (!secret) throw new Error('not configured');
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new Error('malformed');
    const header = part(parts[0]);
    if (!header || header.alg !== 'HS256') throw new Error('alg'); // also rejects "none" and every other alg
    const want = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
    const got = Buffer.from(parts[2], 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw new Error('signature');
    const c = part(parts[1]);
    if (!c || typeof c !== 'object') throw new Error('malformed');
    const now = Math.floor(nowMs / 1000);
    if (c.iss !== iss) throw new Error('iss');
    if (!(Array.isArray(c.aud) ? c.aud.includes(aud) : c.aud === aud)) throw new Error('aud');
    if (typeof c.sub !== 'string' || !c.sub) throw new Error('sub');
    if (!Number.isFinite(c.exp) || c.exp + SKEW_S < now) throw new Error('expired');
    if (!Number.isFinite(c.iat) || c.iat - SKEW_S > now) throw new Error('iat');
    if (c.purpose !== purpose) throw new Error('purpose');
    if (purpose === 'sso' && (!c.jti || c.exp - c.iat > SSO_MAX_LIFETIME_S)) throw new Error('sso claims');
    return c;
}

// Single-use jti set (in memory, single instance; a restart forgets it, which the 60 s lifetime bounds).
const seen = new Map(); // jti -> expiry ms
const MAX_SEEN = 10000;
function consumeJti(jti, expMs, nowMs = Date.now()) {
    for (const [k, e] of seen) if (e < nowMs) seen.delete(k); else break; // insertion order ~ expiry order for 60 s tokens
    if (seen.has(jti)) return false;
    if (seen.size >= MAX_SEEN) seen.delete(seen.keys().next().value);
    seen.set(jti, expMs + SKEW_S * 1000);
    return true;
}

module.exports = { enabled, settings, verifyJwt, consumeJti, _test: { reset: () => seen.clear() } };
