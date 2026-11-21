// AES-256-GCM for user-supplied API keys. Format: v1.<iv>.<tag>.<ciphertext> (base64). The AAD binds a ciphertext to
// `${userId}:${provider}`, so a blob copied onto another user or provider fails to decrypt.
// Key: ENCRYPTION_KEY (64 hex chars or base64 of 32 bytes), else derived from JWT_SECRET (config warns once at startup).
const crypto = require('crypto');

// Pure, shared with config/config.js (Joi). null = not a valid key.
function parseKey(v) {
    if (typeof v !== 'string') return null;
    if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
    if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) {
        const b = Buffer.from(v, 'base64');
        if (b.length === 32) return b;
    }
    return null;
}

let cached = null;
function getKey() {
    if (cached) return cached;
    const env = process.env.ENCRYPTION_KEY;
    if (env) {
        const k = parseKey(env);
        if (!k) throw new Error('ENCRYPTION_KEY must be 64 hex characters or base64 of 32 bytes'); // never print the value
        return (cached = { key: k, fallback: false });
    }
    const secret = require('../config/config').jwt.secret; // lazy: config requires this file for parseKey
    // ponytail: rotating JWT_SECRET makes every saved key unreadable; set ENCRYPTION_KEY to decouple.
    return (cached = { key: Buffer.from(crypto.hkdfSync('sha256', secret, 'trade_mvp', 'ai-keys:v1', 32)), fallback: true });
}

const aad = (userId, provider) => Buffer.from(`${userId}:${provider}`);

function encrypt(plain, userId, provider) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', getKey().key, iv);
    c.setAAD(aad(userId, provider));
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

// Throws Error('secret_unreadable') on any problem (tamper, wrong user/provider, rotated key, bad format).
function decrypt(blob, userId, provider) {
    try {
        const [v, iv, tag, ct] = String(blob).split('.');
        if (v !== 'v1' || !iv || !tag || !ct) throw new Error('format');
        const d = crypto.createDecipheriv('aes-256-gcm', getKey().key, Buffer.from(iv, 'base64'));
        d.setAAD(aad(userId, provider));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
    } catch (e) {
        throw new Error('secret_unreadable');
    }
}

module.exports = { parseKey, encrypt, decrypt, usingFallback: () => getKey().fallback, _test: { reset: () => { cached = null; } } };
