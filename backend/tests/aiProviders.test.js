const dns = require('dns');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');
const P = require('../services/aiProviders');

const KEY = 'sk-test-SECRETKEY-0123456789';
afterEach(() => { jest.restoreAllMocks(); process.env.NODE_ENV = 'test'; });

describe('isBlockedIp', () => {
    test.each([
        '0.0.0.0', '0.1.2.3', '127.0.0.1', '127.9.9.9', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
        '100.64.0.1', '100.127.255.255', '169.254.169.254', '169.254.0.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
        '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1',
        '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:192.168.0.9', '::ffff:169.254.169.254', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', 'not-an-ip',
    ])('%s is blocked', (ip) => expect(P.isBlockedIp(ip)).toBe(true));
    test.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '169.253.0.1', '223.255.255.255', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2001:4860:4860::8888'])('%s is allowed', (ip) => expect(P.isBlockedIp(ip)).toBe(false));
});

describe('checkBaseUrl', () => {
    test('public https hosts pass', () => {
        expect(P.checkBaseUrl('https://api.example.com/v1').hostname).toBe('api.example.com');
        expect(P.checkBaseUrl('https://8.8.8.8/v1').hostname).toBe('8.8.8.8');
    });
    test.each([
        ['not a url'], ['ftp://api.example.com/v1'], ['https://user:pw@api.example.com/v1'], ['https://user@api.example.com/'],
        ['https://api.example.com/v1?x=1'], ['https://api.example.com/v1#h'],
        ['https://localhost/v1'], ['https://LOCALHOST./v1'], ['https://foo.localhost/v1'], ['https://db.internal/v1'], ['https://metadata.google.internal/'],
        ['https://127.0.0.1/v1'], ['https://2130706433/v1'], ['https://0x7f.1/v1'], ['https://10.0.0.1/v1'], ['https://192.168.1.1/v1'],
        ['https://169.254.169.254/latest'], ['https://100.64.0.1/v1'], ['https://[::1]/v1'], ['https://[::ffff:127.0.0.1]/v1'], ['https://[fe80::1]/v1'], ['https://[fd00::1]/v1'], ['https://0.0.0.0/v1'],
    ])('%s is rejected', (u) => {
        expect(() => P.checkBaseUrl(u)).toThrow(expect.objectContaining({ code: 'ai_bad_base_url' }));
    });
    test.each([
        ['https://api.example.com//127.0.0.1/v1'], ['https://api.example.com/\\127.0.0.1/v1'], ['https://api.example.com//169.254.169.254'], ['https://api.example.com/v1//x'],
    ])('protocol-relative path tricks are rejected: %s', (u) => {
        expect(() => P.checkBaseUrl(u)).toThrow(expect.objectContaining({ code: 'ai_bad_base_url' }));
    });
    test('http is allowed only when NODE_ENV is development', () => {
        process.env.NODE_ENV = 'development';
        expect(P.checkBaseUrl('http://api.example.com/v1').protocol).toBe('http:');
        process.env.NODE_ENV = 'test';
        expect(() => P.checkBaseUrl('http://api.example.com/v1')).toThrow(expect.objectContaining({ code: 'ai_bad_base_url' }));
        process.env.NODE_ENV = 'production';
        expect(() => P.checkBaseUrl('http://api.example.com/v1')).toThrow(expect.objectContaining({ code: 'ai_bad_base_url' }));
        expect(P.checkBaseUrl('https://api.example.com/v1').protocol).toBe('https:');
    });
});

describe('guardedLookup (runs at connect time, so DNS rebinding cannot slip past)', () => {
    const answer = (...addrs) => jest.spyOn(dns, 'lookup').mockImplementation((h, o, cb) => cb(null, addrs.map((a) => ({ address: a, family: a.includes(':') ? 6 : 4 }))));
    const run = (opts = {}) => new Promise((resolve) => P.guardedLookup('api.example.com', opts, (err, a, f) => resolve({ err, a, f })));
    test('public answer passes (single and all forms)', async () => {
        answer('93.184.216.34');
        expect((await run()).a).toBe('93.184.216.34');
        expect((await run({ all: true })).a).toEqual([{ address: '93.184.216.34', family: 4 }]);
    });
    test('rejected when ANY address is private, even mixed with a public one', async () => {
        answer('93.184.216.34', '10.0.0.1');
        expect((await run({ all: true })).err).toMatchObject({ code: 'ai_bad_base_url' });
        answer('::ffff:169.254.169.254');
        expect((await run()).err).toMatchObject({ code: 'ai_bad_base_url' });
    });
    test('rebinding: a name that resolves public first and private later is refused on the later connect', async () => {
        const spy = answer('93.184.216.34');
        expect((await run()).err).toBeNull();
        spy.mockImplementation((h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]));
        expect((await run()).err).toMatchObject({ code: 'ai_bad_base_url' });
    });
    test('dns errors pass through', async () => {
        jest.spyOn(dns, 'lookup').mockImplementation((h, o, cb) => cb(new Error('ENOTFOUND')));
        expect((await run()).err.message).toBe('ENOTFOUND');
    });
});

// Fake https/http.request: records the options and body, replies with the scripted response.
function fakeRequest(lib, { status = 200, body = {}, raw, chunks, error } = {}) {
    const calls = [];
    jest.spyOn(lib, 'request').mockImplementation((opts, cb) => {
        const req = new EventEmitter();
        req.destroy = jest.fn();
        req.end = (data) => {
            calls.push({ opts, body: data ? JSON.parse(data.toString()) : null });
            setImmediate(() => {
                if (error) return req.emit('error', error);
                const res = new EventEmitter();
                res.statusCode = status;
                cb(res);
                for (const c of chunks || [raw !== undefined ? raw : JSON.stringify(body)]) res.emit('data', Buffer.from(c));
                res.emit('end');
            });
        };
        return req;
    });
    return calls;
}
const base = { apiKey: KEY, system: 'SYS', user: 'USR', maxTokens: 50 };

describe('complete()', () => {
    test('anthropic: x-api-key header, messages API shape, no temperature, text blocks only', async () => {
        const calls = fakeRequest(https, { body: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'hi' }, { type: 'text', text: ' there' }] } });
        await expect(P.complete({ ...base, provider: 'anthropic', temperature: 0.3 })).resolves.toBe('hi there');
        const { opts, body } = calls[0];
        expect([opts.hostname, opts.path, opts.method]).toEqual(['api.anthropic.com', '/v1/messages', 'POST']);
        expect(opts.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' });
        expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 50, system: 'SYS', messages: [{ role: 'user', content: 'USR' }] });
        expect(body).not.toHaveProperty('temperature');
        expect(opts.lookup).toBeUndefined();
    });
    test('openai: Bearer, chat completions, temperature sent except for gpt-5/o-series', async () => {
        const calls = fakeRequest(https, { body: { choices: [{ message: { content: 'ok' } }] } });
        await expect(P.complete({ ...base, provider: 'openai', model: 'gpt-4.1', temperature: 0.2 })).resolves.toBe('ok');
        expect(calls[0].opts).toMatchObject({ hostname: 'api.openai.com', path: '/v1/chat/completions' });
        expect(calls[0].opts.headers.authorization).toBe(`Bearer ${KEY}`);
        expect(calls[0].body).toMatchObject({ temperature: 0.2, max_completion_tokens: 50, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }] });
        await P.complete({ ...base, provider: 'openai', temperature: 0.2 }); // default gpt-5-mini
        expect(calls[1].body).not.toHaveProperty('temperature');
    });
    test('gemini: key in the x-goog-api-key header, never in the URL', async () => {
        const calls = fakeRequest(https, { body: { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] } });
        await expect(P.complete({ ...base, provider: 'gemini', model: 'gemini-2.5-pro', temperature: 0.5 })).resolves.toBe('ab');
        const { opts, body } = calls[0];
        expect(opts.hostname).toBe('generativelanguage.googleapis.com');
        expect(opts.path).toBe('/v1beta/models/gemini-2.5-pro:generateContent');
        expect(opts.path).not.toContain(KEY);
        expect(opts.headers['x-goog-api-key']).toBe(KEY);
        expect(body.generationConfig).toEqual({ maxOutputTokens: 50, temperature: 0.5 });
    });
    test('openrouter: Bearer to openrouter.ai', async () => {
        const calls = fakeRequest(https, { body: { choices: [{ message: { content: 'r' } }] } });
        await expect(P.complete({ ...base, provider: 'openrouter' })).resolves.toBe('r');
        expect(calls[0].opts).toMatchObject({ hostname: 'openrouter.ai', path: '/api/v1/chat/completions' });
        expect(calls[0].body.model).toBe('anthropic/claude-sonnet-5-5');
    });
    test('custom: base URL + /chat/completions, guarded lookup attached, bad or missing URL and missing model refused before any request', async () => {
        const calls = fakeRequest(https, { body: { choices: [{ message: { content: 'c' } }] } });
        await expect(P.complete({ ...base, provider: 'custom', model: 'llama3', baseUrl: 'https://llm.example.com/v1/' })).resolves.toBe('c');
        expect(calls[0].opts).toMatchObject({ hostname: 'llm.example.com', path: '/v1/chat/completions' });
        expect(calls[0].opts.lookup).toBe(P.guardedLookup);
        for (const [baseUrl, model, code] of [['https://127.0.0.1/v1', 'm', 'ai_bad_base_url'], ['', 'm', 'ai_bad_base_url'], ['https://llm.example.com', '', 'ai_no_model']]) {
            await expect(P.complete({ ...base, provider: 'custom', model, baseUrl })).rejects.toMatchObject({ code });
        }
        expect(calls).toHaveLength(1);
        await expect(P.complete({ ...base, provider: 'custom', model: 'm', baseUrl: 'https://llm.example.com', apiKey: '' })).rejects.toMatchObject({ code: 'ai_no_key' });
    });
    test('custom over http (non-production) uses the http module', async () => {
        process.env.NODE_ENV = 'development';
        const calls = fakeRequest(http, { body: { choices: [{ message: { content: 'h' } }] } });
        await expect(P.complete({ ...base, provider: 'custom', model: 'm', baseUrl: 'http://llm.example.com:8080/v1' })).resolves.toBe('h');
        expect(calls[0].opts).toMatchObject({ hostname: 'llm.example.com', port: '8080' });
    });
    test('status mapping: 401/403 auth failed, 429 rate limited, 5xx/4xx upstream, redirects are NOT followed', async () => {
        for (const [status, code] of [[401, 'ai_auth_failed'], [403, 'ai_auth_failed'], [429, 'ai_rate_limited'], [500, 'ai_upstream_error'], [400, 'ai_upstream_error']]) {
            fakeRequest(https, { status, body: { error: { message: `bad key ${KEY}` } } });
            const e = await P.complete({ ...base, provider: 'openai' }).catch((x) => x);
            expect(e.code).toBe(code);
            expect(e.status).not.toBe(401); // the SPA signs the user out on 401
            expect(JSON.stringify([e.message, e.code, e.status])).not.toContain(KEY);
            jest.restoreAllMocks();
        }
        const calls = fakeRequest(https, { status: 302, body: {} });
        await expect(P.complete({ ...base, provider: 'openai' })).rejects.toMatchObject({ code: 'ai_upstream_error' });
        expect(calls).toHaveLength(1);
    });
    test('network error -> ai_unreachable; an AiError from the lookup hook passes through; bad body -> ai_bad_response', async () => {
        fakeRequest(https, { error: Object.assign(new Error(`connect ECONNREFUSED ${KEY}`), { code: 'ECONNREFUSED' }) });
        const e = await P.complete({ ...base, provider: 'openai' }).catch((x) => x);
        expect(e).toMatchObject({ code: 'ai_unreachable' });
        expect(e.message).not.toContain(KEY);
        jest.restoreAllMocks();
        fakeRequest(https, { error: new P.AiError(400, 'ai_bad_base_url') });
        await expect(P.complete({ ...base, provider: 'custom', model: 'm', baseUrl: 'https://llm.example.com' })).rejects.toMatchObject({ code: 'ai_bad_base_url' });
        jest.restoreAllMocks();
        fakeRequest(https, { raw: 'not json' });
        await expect(P.complete({ ...base, provider: 'openai' })).rejects.toMatchObject({ code: 'ai_bad_response' });
        jest.restoreAllMocks();
        fakeRequest(https, { body: { choices: [] } });
        await expect(P.complete({ ...base, provider: 'openai' })).rejects.toMatchObject({ code: 'ai_bad_response' });
    });
    test('a path that would resolve to another host (//127.0.0.1) never reaches a request', async () => {
        const calls = fakeRequest(https, { body: { choices: [{ message: { content: 'x' } }] } });
        for (const baseUrl of ['https://api.example.com//127.0.0.1/v1', 'https://api.example.com/\\127.0.0.1/v1', 'https://api.example.com//169.254.169.254']) {
            await expect(P.complete({ ...base, provider: 'custom', model: 'm', baseUrl })).rejects.toMatchObject({ code: 'ai_bad_base_url' });
        }
        expect(calls).toHaveLength(0);
        await P.complete({ ...base, provider: 'custom', model: 'm', baseUrl: 'https://api.example.com/v1/' });
        expect(calls[0].opts.hostname).toBe('api.example.com'); // normal URLs still land on the saved host
    });
    test('responses over 1MB are cut off', async () => {
        fakeRequest(https, { chunks: ['x'.repeat(600 * 1024), 'x'.repeat(600 * 1024)] });
        await expect(P.complete({ ...base, provider: 'openai' })).rejects.toMatchObject({ code: 'ai_bad_response' });
    });
    test('unknown provider is refused', async () => {
        await expect(P.complete({ ...base, provider: 'nope' })).rejects.toMatchObject({ code: 'ai_bad_provider' });
    });
});

describe('LM Studio (lmstudio): loopback-only base URL, no key, reasoning-model handling', () => {
    const okLocal = { choices: [{ message: { content: 'hi' } }] };
    afterEach(() => { delete process.env.ALLOW_LOCAL_LLM; delete process.env.LMSTUDIO_BASE_URL; delete process.env.LMSTUDIO_MODEL; delete process.env.LMSTUDIO_MAX_TOKENS; });

    test.each(['http://localhost:1234/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:1234/v1', 'https://localhost/v1', 'http://LOCALHOST:1234/v1', 'http://localhost'])('allowed: %s', (u) => {
        expect(() => P.checkLocalUrl(u)).not.toThrow();
    });
    test.each([
        ['userinfo', 'http://localhost@evil.com/v1'], ['userinfo with port', 'http://localhost:1234@evil.com/v1'], ['fragment-userinfo', 'http://evil.com#@localhost/'],
        ['decimal loopback', 'http://2130706433:1234/v1'], ['hex loopback', 'http://0x7f.1:1234/v1'], ['short loopback', 'http://127.1:1234/v1'], ['other 127/8', 'http://127.0.0.2:1234/v1'],
        ['mapped IPv6', 'http://[::ffff:127.0.0.1]:1234/v1'], ['long IPv6', 'http://[0:0:0:0:0:0:0:1]:1234/v1'], ['unspecified', 'http://0.0.0.0:1234/v1'],
        ['DNS name to loopback', 'http://127.0.0.1.nip.io:1234/v1'], ['localtest.me', 'http://localtest.me:1234/v1'], ['sub.localhost', 'http://lm.localhost:1234/v1'], ['trailing dot', 'http://localhost.:1234/v1'],
        ['private', 'http://10.0.0.1:1234/v1'], ['private 192', 'http://192.168.1.5:1234/v1'], ['metadata', 'http://169.254.169.254/latest'], ['public', 'https://api.example.com/v1'],
        ['// path', 'http://localhost:1234//evil.com/v1'], ['backslash', 'http://localhost:1234/\\evil.com'], ['query', 'http://localhost:1234/v1?x=1'], ['hash', 'http://localhost:1234/v1#x'],
        ['ftp', 'ftp://localhost/v1'], ['file', 'file:///etc/passwd'], ['garbage', 'not a url'],
    ])('denied (%s): %s', (_, u) => {
        expect(() => P.checkLocalUrl(u)).toThrow(expect.objectContaining({ code: 'ai_bad_base_url' }));
    });
    test('production denies even localhost unless ALLOW_LOCAL_LLM=true', () => {
        process.env.NODE_ENV = 'production';
        expect(() => P.checkLocalUrl('http://localhost:1234/v1')).toThrow(expect.objectContaining({ code: 'ai_local_disabled' }));
        process.env.ALLOW_LOCAL_LLM = '1';
        expect(() => P.checkLocalUrl('http://localhost:1234/v1')).toThrow(expect.objectContaining({ code: 'ai_local_disabled' }));
        process.env.ALLOW_LOCAL_LLM = 'true';
        expect(P.checkLocalUrl('http://localhost:1234/v1').port).toBe('1234');
        expect(() => P.checkLocalUrl('http://10.0.0.1:1234/v1')).toThrow(expect.objectContaining({ code: 'ai_bad_base_url' })); // the flag never widens the host list
    });
    test('the custom provider still refuses localhost', () => {
        expect(() => P.checkBaseUrl('http://localhost:1234/v1')).toThrow(expect.objectContaining({ code: 'ai_bad_base_url' }));
    });

    test('loopbackLookup: localhost must resolve to loopback only', async () => {
        const run = () => new Promise((resolve) => P.loopbackLookup('localhost', {}, (err, a) => resolve({ err, a })));
        jest.spyOn(dns, 'lookup').mockImplementation((h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]));
        expect((await run()).a).toBe('127.0.0.1');
        dns.lookup.mockImplementation((h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }, { address: '10.0.0.1', family: 4 }]));
        expect((await run()).err).toMatchObject({ code: 'ai_bad_base_url' });
        dns.lookup.mockImplementation((h, o, cb) => cb(null, [{ address: '::ffff:169.254.169.254', family: 6 }]));
        expect((await run()).err).toMatchObject({ code: 'ai_bad_base_url' });
    });

    test('no key needed: default base URL and model, placeholder bearer, generous max_tokens, 120 s path, loopback lookup', async () => {
        const calls = fakeRequest(http, { body: okLocal });
        await expect(P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U', maxTokens: 16, temperature: 0.3 })).resolves.toBe('hi');
        const { opts, body } = calls[0];
        expect(opts).toMatchObject({ method: 'POST', hostname: 'localhost', port: '1234', path: '/v1/chat/completions' });
        expect(opts.headers.authorization).toBe('Bearer lm-studio');
        expect(opts.lookup).toBe(P.loopbackLookup);
        expect(body).toMatchObject({ model: 'qwen/qwen3.5-9b', temperature: 0.3, reasoning_effort: 'none' });
        expect(body.max_tokens).toBeGreaterThanOrEqual(1500);
    });
    test('a user key is never forwarded to the local server; env defaults apply', async () => {
        process.env.LMSTUDIO_BASE_URL = 'http://127.0.0.1:4321/api/v1';
        process.env.LMSTUDIO_MODEL = 'local/other';
        process.env.LMSTUDIO_MAX_TOKENS = '6000';
        const calls = fakeRequest(http, { body: okLocal });
        await P.complete({ provider: 'lmstudio', apiKey: KEY, system: 'S', user: 'U', maxTokens: 16 });
        expect(calls[0].opts).toMatchObject({ hostname: '127.0.0.1', port: '4321', path: '/api/v1/chat/completions' });
        expect(calls[0].body).toMatchObject({ model: 'local/other', max_tokens: 6000 });
        expect(JSON.stringify(calls[0])).not.toContain(KEY);
    });
    test('a saved base URL that fails the guard never reaches a request', async () => {
        const calls = fakeRequest(http, { body: okLocal });
        for (const baseUrl of ['http://10.0.0.1:1234/v1', 'http://localhost@evil.com/v1', 'http://localhost:1234//169.254.169.254', 'https://api.example.com/v1']) {
            await expect(P.complete({ provider: 'lmstudio', apiKey: '', baseUrl, system: 'S', user: 'U' })).rejects.toMatchObject({ code: 'ai_bad_base_url' });
        }
        expect(calls).toHaveLength(0);
    });
    test('reasoning: <think> blocks stripped, reasoning_content never returned, all-thinking -> ai_reasoning_budget', async () => {
        fakeRequest(http, { body: { choices: [{ message: { content: '<think>secret plan</think>\nAnswer: up', reasoning_content: 'more secret' } }] } });
        const out = await P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U' });
        expect(out).toBe('Answer: up');
        jest.restoreAllMocks();
        fakeRequest(http, { body: { choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'thinking...' } }] } });
        await expect(P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U' })).rejects.toMatchObject({ status: 502, code: 'ai_reasoning_budget' });
        jest.restoreAllMocks();
        fakeRequest(http, { body: { choices: [{ message: { content: '<think>never closed' } }] } });
        await expect(P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U' })).rejects.toMatchObject({ code: 'ai_reasoning_budget' });
        jest.restoreAllMocks();
        fakeRequest(http, { body: { choices: [{ message: { content: '' } }] } });
        await expect(P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U' })).rejects.toMatchObject({ code: 'ai_bad_response' });
    });
    test('redirects are not followed; connection refused -> ai_unreachable', async () => {
        const calls = fakeRequest(http, { status: 307, body: {} });
        await expect(P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U' })).rejects.toMatchObject({ code: 'ai_upstream_error' });
        expect(calls).toHaveLength(1);
        jest.restoreAllMocks();
        fakeRequest(http, { error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
        await expect(P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U' })).rejects.toMatchObject({ code: 'ai_unreachable' });
    });
    test('context overflow (LM Studio error shape) -> ai_context_too_small with a capped detail, logged at warn without the prompt', async () => {
        const logger = require('../config/logger');
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        const msg = 'Engine protocol predict request returned 400: {"error":{"code":400,"message":"request (11905 tokens) exceeds the available context size (8192 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":11905,"n_ctx":8192}}';
        fakeRequest(http, { status: 400, body: { error: msg } });
        const e = await P.complete({ provider: 'lmstudio', apiKey: '', system: 'SYSPROMPT', user: 'USERPROMPT' }).catch((x) => x);
        expect(e).toMatchObject({ status: 502, code: 'ai_context_too_small' });
        expect(e.detail).toContain('exceeds the available context size');
        expect(e.detail.length).toBeLessThanOrEqual(200);
        const line = warn.mock.calls[0][0];
        expect(line).toMatch(/provider=lmstudio status=400 message=Engine protocol/);
        expect(line).not.toMatch(/SYSPROMPT|USERPROMPT|Bearer/);
        jest.restoreAllMocks();
        jest.spyOn(logger, 'warn').mockImplementation(() => {});
        fakeRequest(http, { status: 400, body: { error: { message: `bad param ${'x'.repeat(400)}` } } });
        const e2 = await P.complete({ provider: 'lmstudio', apiKey: '', system: 'S', user: 'U' }).catch((x) => x);
        expect(e2).toMatchObject({ code: 'ai_upstream_error' });
        expect(e2.detail).toMatch(/^bad param x+$/);
        expect(e2.detail.length).toBe(200);
    });
    test('hosted providers: upstream text is logged with the key masked and never returned as detail', async () => {
        const logger = require('../config/logger');
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
        fakeRequest(https, { status: 400, body: { error: { message: `context length exceeded for ${KEY}` } } });
        const e = await P.complete({ provider: 'openai', apiKey: KEY, system: 'S', user: 'U' }).catch((x) => x);
        expect(e.code).toBe('ai_upstream_error');
        expect(e.detail).toBeUndefined();
        expect(warn.mock.calls[0][0]).toMatch(/provider=openai status=400 message=context length exceeded for \[key\]/);
        expect(warn.mock.calls[0][0]).not.toContain(KEY);
    });
    test('listLocalModels: GET {base}/models, chat models only, same guard', async () => {
        const calls = fakeRequest(http, { body: { object: 'list', data: [{ id: 'qwen/qwen3.5-9b', object: 'model' }, { id: 'text-embedding-nomic-embed-text-v1.5', object: 'model' }, { id: 'bad id;x' }, null] } });
        await expect(P.listLocalModels('')).resolves.toEqual(['qwen/qwen3.5-9b']);
        const { opts, body } = calls[0];
        expect(body).toBeNull();
        expect(opts.headers).not.toHaveProperty('content-length');
        expect(opts).toMatchObject({ method: 'GET', hostname: 'localhost', path: '/v1/models' });
        expect(opts.lookup).toBe(P.loopbackLookup);
        await expect(P.listLocalModels('http://10.0.0.1:1234/v1')).rejects.toMatchObject({ code: 'ai_bad_base_url' });
    });
});
