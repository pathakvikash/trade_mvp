jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const logger = require('../config/logger');
const errorHandler = require('../middleware/errorHandler');
const { createLimiter, ipKey } = require('../middleware/rateLimit');

const res = () => {
    const r = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() {}, headersSent: false };
    return r;
};

describe('errorHandler', () => {
    beforeEach(() => jest.clearAllMocks());
    test('body-parser errors log type and status only, never the quoted body', () => {
        const err = Object.assign(new SyntaxError('Unexpected token in JSON: {"password":"hunter2"}'), { type: 'entity.parse.failed', status: 400 });
        const r = res();
        errorHandler(err, { method: 'POST', originalUrl: '/api/auth/login?x=1' }, r, () => {});
        const logged = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join(' ');
        expect(logged).toContain('entity.parse.failed');
        expect(logged).not.toMatch(/hunter2|Unexpected token|SyntaxError/);
        expect(r.code).toBe(400);
    });
    test('other errors still log the stack and answer 500', () => {
        const r = res();
        errorHandler(new Error('boom'), { method: 'GET', originalUrl: '/x' }, r, () => {});
        expect(logger.error.mock.calls[0][0]).toMatch(/boom/);
        expect(r.code).toBe(500);
    });
});

describe('logger redaction', () => {
    test('removes sensitive keys at any depth (bounded) without mutating the caller object', () => {
        jest.isolateModules(() => {
            jest.unmock('../config/logger');
            const real = require('../config/logger');
            const meta = { a: { b: { Authorization: 'Bearer s3', ok: 1, list: [{ password: 'p', keep: 2 }] } }, refreshToken: 't', cookie: 'c' };
            const out = real.format.transform({ level: 'info', message: 'm', meta, config: { data: 'x' } });
            const json = out[Symbol.for('message')];
            expect(json).not.toMatch(/s3|"p"|"t"|"c"|"x"/);
            expect(JSON.parse(json).meta.a.b).toEqual({ ok: 1, list: [{ keep: 2 }] });
            expect(meta.a.b.Authorization).toBe('Bearer s3'); // caller's object untouched
        });
    });
    test('under NODE_ENV=test no file transport exists', () => {
        jest.isolateModules(() => {
            jest.unmock('../config/logger');
            const real = require('../config/logger');
            expect(real.transports.some((t) => t.filename)).toBe(false);
        });
    });
});

describe('config JWT_SECRET', () => {
    const load = (secret) => {
        let err;
        jest.isolateModules(() => {
            const old = process.env.JWT_SECRET;
            process.env.JWT_SECRET = secret;
            try { require('../config/config'); } catch (e) { err = e; }
            process.env.JWT_SECRET = old;
        });
        return err;
    };
    test('rejects placeholders and short values without echoing them, accepts a random one', () => {
        expect(load('change-me-to-a-random-48-byte-value-xxxxxxxx')).toBeTruthy();
        expect(load('short')).toBeTruthy();
        expect(load('short').message).not.toMatch(/short"/);
        expect(load('Zq8vK2mP9xLw4TnB7sYc1dRf6HgJ3aUe5oNi0VtXkQbE')).toBeUndefined();
    });
});

describe('rate limiter', () => {
    test('ipKey: IPv4 as is, IPv4-mapped -> IPv4, IPv6 -> /64', () => {
        expect(ipKey('1.2.3.4')).toBe('1.2.3.4');
        expect(ipKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
        expect(ipKey('2001:db8:abcd:12:1:2:3:4')).toBe(ipKey('2001:DB8:abcd:12:ffff::9'));
        expect(ipKey('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:12::/64');
        expect(ipKey('2001:db8:abcd:13::1')).not.toBe(ipKey('2001:db8:abcd:12::1'));
        expect(ipKey('::1')).toBe('0:0:0:0::/64');
        expect(ipKey('fe80::1%eth0')).toBe(ipKey('fe80::2'));
    });
    test('missing IP uses one fixed key and warns once', () => {
        logger.warn.mockClear();
        expect(ipKey(undefined)).toBe('no-ip');
        expect(ipKey('')).toBe('no-ip');
        expect(logger.warn.mock.calls.filter((c) => /without an IP/.test(c[0])).length).toBeLessThanOrEqual(1);
    });
    test('a full map evicts the least recently active key; recent keys keep counting', () => {
        const check = createLimiter({ limit: 1, windowMs: 60000 });
        const r = { set() {}, status() { return this; }, json() {} };
        expect(check('first', r)).toBe(false);
        for (let i = 0; i < 5000; i++) check(`k${i}`, r); // fills the map past MAX_KEYS, evicting 'first'
        expect(check('first', r)).toBe(false); // was evicted, so counts as new
        expect(check('k4999', r)).toBe(true); // still tracked, over its limit
    });
});
