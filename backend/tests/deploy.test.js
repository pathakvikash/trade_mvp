// Deploy blockers: TRUST_PROXY, production console logging, /api/health, HOST default, production config safety.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const express = require('express');
const mongoose = require('mongoose');
const { initializeDefaultUsers, devHint } = require('../controllers/authController'); // loaded under NODE_ENV=test

const KEYS = ['NODE_ENV', 'TRUST_PROXY', 'HOST', 'LOG_TO_FILES', 'CORS_ORIGINS', 'SEED_DEMO_USERS', 'JWT_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
const GOOD_SECRET = 'Zq8vK2mP9xLw4TnB7sYc1dRf6HgJ3aUe5oNi0VtXkQbE';
const saved = {};
beforeAll(() => KEYS.forEach((k) => { saved[k] = process.env[k]; }));
afterEach(() => KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

// Loads the real config under the given env (unset = delete). Returns { cfg } or { err }.
const load = (env = {}) => {
    const out = {};
    jest.isolateModules(() => {
        ['TRUST_PROXY', 'HOST', 'LOG_TO_FILES', 'CORS_ORIGINS', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].forEach((k) => delete process.env[k]);
        Object.assign(process.env, { NODE_ENV: 'development', SEED_DEMO_USERS: 'false' }, env);
        try { out.cfg = require('../config/config'); } catch (e) { out.err = e; }
    });
    return out;
};
const PROD = { NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example.org', JWT_SECRET: GOOD_SECRET, ANTHROPIC_API_KEY: 'sk-test-dummy' };

describe('TRUST_PROXY', () => {
    test('parses false (default), hop counts and true; rejects junk', () => {
        expect(load().cfg.trustProxy).toBe(0);
        expect(load({ TRUST_PROXY: 'false' }).cfg.trustProxy).toBe(false);
        expect(load({ TRUST_PROXY: '1' }).cfg.trustProxy).toBe(1);
        expect(load({ TRUST_PROXY: 'TRUE' }).cfg.trustProxy).toBe(true);
        expect(load({ TRUST_PROXY: 'yes' }).err).toBeTruthy();
        expect(load({ TRUST_PROXY: '-1' }).err).toBeTruthy();
    });
    // req.ip is what ipKey() and every limitBy() key function use.
    const ipFor = (trust, xff, peer) => {
        const app = express();
        app.set('trust proxy', trust);
        const req = Object.create(app.request);
        req.app = app;
        req.headers = xff ? { 'x-forwarded-for': xff } : {};
        req.socket = req.connection = { remoteAddress: peer };
        return req.ip;
    };
    test('off: everyone is the proxy; 1 hop: the real client; spoofed extra hops are ignored', () => {
        expect(ipFor(0, '9.9.9.9', '10.0.0.2')).toBe('10.0.0.2');
        expect(ipFor(1, '9.9.9.9', '10.0.0.2')).toBe('9.9.9.9');
        expect(ipFor(1, '6.6.6.6, 9.9.9.9', '10.0.0.2')).toBe('9.9.9.9'); // client-supplied left entry not trusted
    });
    test('two clients behind one proxy get different limiter keys only with trust proxy on', () => {
        const { ipKey } = require('../middleware/rateLimit');
        expect(ipKey(ipFor(0, '1.1.1.1', '10.0.0.2'))).toBe(ipKey(ipFor(0, '2.2.2.2', '10.0.0.2')));
        expect(ipKey(ipFor(1, '1.1.1.1', '10.0.0.2'))).not.toBe(ipKey(ipFor(1, '2.2.2.2', '10.0.0.2')));
    });
});

describe('HOST default', () => {
    test('127.0.0.1 in development, 0.0.0.0 in production, explicit HOST wins', () => {
        expect(load().cfg.host).toBe('127.0.0.1');
        expect(load({ ...PROD }).cfg.host).toBe('0.0.0.0');
        expect(load({ ...PROD, HOST: '10.1.2.3' }).cfg.host).toBe('10.1.2.3');
        expect(load({ HOST: '0.0.0.0' }).cfg.host).toBe('0.0.0.0');
    });
});

describe('LOG_TO_FILES and console logging', () => {
    test('files default on outside production, off in production, overridable', () => {
        expect(load().cfg.logToFiles).toBe(true);
        expect(load({ ...PROD }).cfg.logToFiles).toBe(false);
        expect(load({ ...PROD, LOG_TO_FILES: 'true' }).cfg.logToFiles).toBe(true);
        expect(load({ LOG_TO_FILES: 'false' }).cfg.logToFiles).toBe(false);
        expect(load({ LOG_TO_FILES: 'maybe' }).err).toBeTruthy();
    });
    test('production logger has a live console transport and no file transport by default', () => {
        let real;
        jest.isolateModules(() => {
            Object.assign(process.env, PROD);
            delete process.env.LOG_TO_FILES;
            real = jest.requireActual('../config/logger');
            process.env.NODE_ENV = 'test';
        });
        const consoles = real.transports.filter((t) => t.name === 'console');
        expect(consoles).toHaveLength(1);
        expect(consoles[0].silent).toBeFalsy();
        expect(real.transports.some((t) => t.filename)).toBe(false);
        real.close();
    });
});

describe('/api/health', () => {
    const call = () => {
        const router = require('../routes/healthRoutes');
        const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.get);
        const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
        layer.route.stack[0].handle({}, res);
        return res;
    };
    const setState = (n) => Object.defineProperty(mongoose.connection, 'readyState', { value: n, configurable: true });
    afterEach(() => { delete mongoose.connection.readyState; });
    test('unauthenticated 200 with only ok/uptime/mongo; mongo reflects readyState', () => {
        setState(1);
        let r = call();
        expect(r.code).toBe(200);
        expect(Object.keys(r.body).sort()).toEqual(['mongo', 'ok', 'uptime']);
        expect(r.body).toMatchObject({ ok: true, mongo: 'up' });
        expect(typeof r.body.uptime).toBe('number');
        setState(0);
        r = call();
        expect(r.code).toBe(200);
        expect(r.body.mongo).toBe('down');
    });
    test('the route has no auth middleware', () => {
        const layer = require('../routes/healthRoutes').stack.find((l) => l.route);
        expect(layer.route.stack).toHaveLength(1);
    });
});

describe('production config safety', () => {
    test('a valid production config loads', () => {
        const { cfg, err } = load({ ...PROD });
        expect(err).toBeUndefined();
        expect(cfg.warnings).toEqual([]);
    });
    test('demo seeding is refused in production (and fine in development)', () => {
        const { err } = load({ ...PROD, SEED_DEMO_USERS: 'true' });
        expect(err.message).toMatch(/SEED_DEMO_USERS/);
        expect(load({ SEED_DEMO_USERS: 'true' }).err).toBeUndefined();
    });
    test('JWT_SECRET must be >= 32 chars and not a placeholder in production, without echoing it', () => {
        expect(load({ ...PROD, JWT_SECRET: 'short-but-unique-1' }).err).toBeTruthy();
        const bad = load({ ...PROD, JWT_SECRET: 'change-me-change-me-change-me-change-me-0' });
        expect(bad.err).toBeTruthy();
        expect(bad.err.message).not.toMatch(/change-me-change/);
    });
    test('CORS_ORIGINS is required, non-empty and wildcard-free in production', () => {
        const noCors = { ...PROD };
        delete noCors.CORS_ORIGINS;
        expect(load(noCors).err).toBeTruthy();
        expect(load({ ...PROD, CORS_ORIGINS: ' , ' }).err.message).toMatch(/CORS_ORIGINS/);
        expect(load({ ...PROD, CORS_ORIGINS: '*' }).err.message).toMatch(/wildcard/);
        expect(load({ ...PROD, CORS_ORIGINS: 'https://a.example.org,https://*.example.org' }).err.message).toMatch(/wildcard/);
        expect(load({ NODE_ENV: 'development', JWT_SECRET: GOOD_SECRET }).err).toBeUndefined(); // dev keeps its default
    });
    test('missing ANTHROPIC credentials only warn in production', () => {
        const env = { ...PROD };
        delete env.ANTHROPIC_API_KEY;
        const { cfg, err } = load(env);
        expect(err).toBeUndefined();
        expect(cfg.warnings.join(' ')).toMatch(/ANTHROPIC_API_KEY.*DISABLED/);
        expect(load({ ...env, ANTHROPIC_AUTH_TOKEN: 't' }).cfg.warnings).toEqual([]);
    });
});

describe('AI provider and demo seeding in production', () => {
    test('provider() ignores the CLI in production even with no API key', async () => {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_AUTH_TOKEN;
        delete process.env.AI_PROVIDER;
        process.env.NODE_ENV = 'production';
        let ai;
        jest.isolateModules(() => {
            jest.doMock('child_process', () => ({ spawn: jest.fn(() => { throw new Error('CLI must not be spawned'); }) }));
            ai = require('../services/aiService');
        });
        expect(await ai.cliAvailable()).toBe(false);
        expect(await ai.provider()).not.toBe('cli');
        process.env.NODE_ENV = 'test';
        jest.dontMock('child_process');
    });
    test('initializeDefaultUsers refuses to seed in production and logs an error', async () => {
        const logger = require('../config/logger');
        const User = require('../models/User');
        const spies = [jest.spyOn(User, 'findOne'), jest.spyOn(User, 'create')];
        process.env.NODE_ENV = 'production';
        process.env.SEED_DEMO_USERS = 'true';
        process.env.DEMO_GUEST_PASSWORD = 'a-long-demo-password';
        await initializeDefaultUsers();
        delete process.env.DEMO_GUEST_PASSWORD;
        expect(spies.every((s) => !s.mock.calls.length)).toBe(true);
        expect(logger.error).toHaveBeenCalled();
    });
    test('dev-hint stays gated: 404 outside development', async () => {
        process.env.NODE_ENV = 'production';
        process.env.SEED_DEMO_USERS = 'true';
        process.env.DEMO_GUEST_PASSWORD = 'a-long-demo-password';
        const res = { status(c) { this.code = c; return this; }, json() { return this; } };
        devHint({ socket: { remoteAddress: '127.0.0.1' } }, res);
        delete process.env.DEMO_GUEST_PASSWORD;
        expect(res.code).toBe(404);
    });
});

describe('.env.example', () => {
    const parsed = require('dotenv').parse(require('fs').readFileSync(require('path').join(__dirname, '..', '.env.example')));
    test('copied as-is (plus a real JWT_SECRET) loads in development', () => {
        const { cfg, err } = load({ ...parsed, JWT_SECRET: GOOD_SECRET });
        expect(err).toBeUndefined();
        expect(cfg.port).toBe(4000);
    });
    test('set-but-empty optional vars mean default; empty CORS_ORIGINS is still rejected in production', () => {
        const empty = { PORT: '', HOST: '', TRUST_PROXY: '', LOG_TO_FILES: '', CORS_ORIGINS: '' };
        const { cfg, err } = load({ ...empty, JWT_SECRET: GOOD_SECRET });
        expect(err).toBeUndefined();
        expect(cfg).toMatchObject({ port: 4000, host: '127.0.0.1', trustProxy: 0, logToFiles: true });
        expect(load({ ...PROD, CORS_ORIGINS: '' }).err).toBeTruthy();
    });
});
