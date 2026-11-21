jest.mock('../config/config', () => ({ jwt: { secret: 'k'.repeat(40) } }));
const sb = require('../services/secretBox');

const saved = process.env.ENCRYPTION_KEY;
beforeEach(() => { delete process.env.ENCRYPTION_KEY; sb._test.reset(); });
afterAll(() => { if (saved === undefined) delete process.env.ENCRYPTION_KEY; else process.env.ENCRYPTION_KEY = saved; sb._test.reset(); });

const PLAIN = 'sk-test-1234567890abcdef';

test('round trip, v1 format, and a fresh IV every time', () => {
    const a = sb.encrypt(PLAIN, 'u1', 'openai');
    const b = sb.encrypt(PLAIN, 'u1', 'openai');
    expect(a.split('.')).toHaveLength(4);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain(PLAIN);
    expect(a).not.toBe(b);
    expect(sb.decrypt(a, 'u1', 'openai')).toBe(PLAIN);
});

test('tampered ciphertext, tag, IV or format fails', () => {
    const [v, iv, tag, ct] = sb.encrypt(PLAIN, 'u1', 'openai').split('.');
    const flip = (s) => Buffer.from(Buffer.from(s, 'base64').map((x, i) => (i === 0 ? x ^ 1 : x))).toString('base64');
    for (const blob of [[v, iv, tag, flip(ct)], [v, iv, flip(tag), ct], [v, flip(iv), tag, ct], ['v2', iv, tag, ct], [v, iv, tag]]) {
        expect(() => sb.decrypt(blob.join('.'), 'u1', 'openai')).toThrow('secret_unreadable');
    }
    expect(() => sb.decrypt('garbage', 'u1', 'openai')).toThrow('secret_unreadable');
});

test('AAD binds the blob to user and provider: copying it elsewhere fails', () => {
    const blob = sb.encrypt(PLAIN, 'u1', 'openai');
    expect(() => sb.decrypt(blob, 'u2', 'openai')).toThrow('secret_unreadable');
    expect(() => sb.decrypt(blob, 'u1', 'anthropic')).toThrow('secret_unreadable');
});

test('without ENCRYPTION_KEY the key is derived from JWT_SECRET: stable across restarts, flagged as fallback', () => {
    expect(sb.usingFallback()).toBe(true);
    const blob = sb.encrypt(PLAIN, 'u1', 'openai');
    sb._test.reset(); // "restart"
    expect(sb.decrypt(blob, 'u1', 'openai')).toBe(PLAIN);
});

test('ENCRYPTION_KEY (hex or base64) takes over; blobs from the fallback key become unreadable', () => {
    const blob = sb.encrypt(PLAIN, 'u1', 'openai');
    process.env.ENCRYPTION_KEY = 'ab'.repeat(32);
    sb._test.reset();
    expect(sb.usingFallback()).toBe(false);
    expect(() => sb.decrypt(blob, 'u1', 'openai')).toThrow('secret_unreadable');
    const hexBlob = sb.encrypt(PLAIN, 'u1', 'openai');
    process.env.ENCRYPTION_KEY = Buffer.from('ab'.repeat(32), 'hex').toString('base64'); // same 32 bytes
    sb._test.reset();
    expect(sb.decrypt(hexBlob, 'u1', 'openai')).toBe(PLAIN);
});

test('an invalid ENCRYPTION_KEY throws a clear error that does not contain the value', () => {
    process.env.ENCRYPTION_KEY = 'not-a-valid-key-marker-xyz';
    sb._test.reset();
    expect(() => sb.encrypt(PLAIN, 'u1', 'openai')).toThrow(/ENCRYPTION_KEY must be/);
    try { sb.encrypt(PLAIN, 'u1', 'openai'); } catch (e) { expect(e.message).not.toContain('marker-xyz'); }
    expect(sb.parseKey('ab'.repeat(32))).toHaveLength(32);
    expect(sb.parseKey('ab'.repeat(31))).toBeNull();
    expect(sb.parseKey(Buffer.alloc(31).toString('base64'))).toBeNull();
});
