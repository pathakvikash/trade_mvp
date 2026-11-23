const logger = require('../config/logger');
const { cached, lastGood, remember, clear } = require('../services/marketData/cache');
const { breaker, isBlocked, fallbackable } = require('../services/marketData/breaker');
const v = require('../services/marketData/validate');

const err = (status, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, headers, data: {} } });

beforeEach(() => { clear(); jest.spyOn(logger, 'warn').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('cache', () => {
    test('concurrent callers share one request; failure is evicted', async () => {
        const fn = jest.fn(() => Promise.resolve(1));
        await Promise.all([cached('k', 1000, fn), cached('k', 1000, fn)]);
        expect(fn).toHaveBeenCalledTimes(1);
        const bad = jest.fn(() => Promise.reject(new Error('x')));
        await cached('b', 1000, bad).catch(() => {});
        await cached('b', 1000, bad).catch(() => {});
        expect(bad).toHaveBeenCalledTimes(2);
    });
    test('lastGood keeps the value and time', () => {
        remember('q', { a: 1 });
        expect(lastGood.get('q')).toMatchObject({ value: { a: 1 } });
        expect(typeof lastGood.get('q').at).toBe('number');
    });
});

describe('breaker', () => {
    let now;
    let fn;
    beforeEach(() => { now = 1e12; jest.spyOn(Date, 'now').mockImplementation(() => now); fn = jest.fn(); });
    const call = (b) => b.run(fn).catch((e) => e);

    test.each([418, 403, 451, 429])('%i trips; later calls short-circuit with blocked:true and no fn call', async (st) => {
        const b = breaker('t', { tripOnNetwork: true });
        fn.mockRejectedValue(err(st));
        await call(b);
        expect(b.state()).toMatchObject({ state: 'open', lastStatus: st });
        const e = await call(b);
        expect(e.blocked).toBe(true);
        expect(isBlocked(e) && fallbackable(e)).toBe(true);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('network error and 5xx trip only with tripOnNetwork', async () => {
        for (const e of [new Error('ECONNRESET'), err(503)]) {
            const on = breaker('on', { tripOnNetwork: true });
            const off = breaker('off', { tripOnNetwork: false });
            fn.mockRejectedValue(e);
            await call(on);
            await call(off);
            expect(on.state().state).toBe('open');
            expect(off.state().state).toBe('closed');
        }
    });

    test('a 400 never trips', async () => {
        const b = breaker('t', { tripOnNetwork: true });
        fn.mockRejectedValue(err(400));
        await call(b);
        expect(b.state().state).toBe('closed');
    });

    test('429 uses Retry-After, default 60 s; 418 keeps the 300 s floor; longer Retry-After wins', async () => {
        const open = async (e) => { const b = breaker('t'); fn.mockRejectedValue(e); await call(b); return b.state().openUntil - now; };
        expect(await open(err(429))).toBe(60e3);
        expect(await open(err(429, { 'retry-after': '10' }))).toBe(10e3);
        expect(await open(err(418, { 'retry-after': '30' }))).toBe(300e3);
        expect(await open(err(418, { 'retry-after': '900' }))).toBe(900e3);
    });

    test('exactly one probe under concurrency; failed probe keeps it open; only a successful probe closes it', async () => {
        const b = breaker('t', { tripOnNetwork: true });
        fn.mockRejectedValue(err(418));
        await call(b);
        now += 301e3;
        let release;
        fn.mockImplementationOnce(() => new Promise((_, rej) => { release = () => rej(new Error('down')); }));
        const probe = call(b);
        expect(b.state().state).toBe('probing');
        const other = await call(b); // while probing: short-circuit
        expect(other.blocked).toBe(true);
        release();
        await probe;
        expect(fn).toHaveBeenCalledTimes(2);
        expect(b.state().state).toBe('open'); // network-error probe: stays open for another 300 s
        expect(b.state().openUntil).toBe(now + 300e3);
        now += 301e3;
        fn.mockResolvedValue('ok');
        expect(await b.run(fn)).toBe('ok');
        expect(b.state().state).toBe('closed');
    });

    test('a probe answered with a 4xx closes it', async () => {
        const b = breaker('t');
        fn.mockRejectedValue(err(418));
        await call(b);
        now += 301e3;
        fn.mockRejectedValue(err(404));
        await call(b);
        expect(b.state().state).toBe('closed');
    });

    test('a request that started before the trip does not close it', async () => {
        const b = breaker('t');
        let release;
        fn.mockImplementationOnce(() => new Promise((r) => { release = () => r('late'); }));
        const early = b.run(fn);
        fn.mockRejectedValue(err(418));
        await call(b);
        release();
        await early;
        expect(b.state().state).toBe('open');
    });
});

describe('validate.candles', () => {
    const NOW = 1e12;
    const H = 3600e3;
    const t0 = (Math.floor(NOW / H) * H) / 1000;
    const c = (i, o = {}) => ({ time: t0 - i * 3600, open: 10, high: 11, low: 9, close: 10, volume: 5, ...o });

    test('drops NaN/zero rows, clamps, dedupes (last wins), sorts, drops future rows, fixes volume', () => {
        const rows = [
            c(1, { close: NaN }), c(2, { open: 0 }), c(3, { low: -1 }),
            c(4, { high: 8, open: 10, close: 12, low: 11 }), // high<close, low>open
            c(5, { volume: -3 }), c(6, { volume: NaN }),
            c(7), c(7, { close: 10.5 }), // duplicate
            c(0), c(-5), // c(-5) is 5 h in the future
        ];
        const out = v.candles(rows, H, NOW, { allowStale: true });
        expect(out.map((r) => r.time)).toEqual([t0 - 7 * 3600, t0 - 6 * 3600, t0 - 5 * 3600, t0 - 4 * 3600, t0]);
        expect(out[0].close).toBe(10.5);
        expect(out[1].volume).toBe(0);
        expect(out[2].volume).toBe(0);
        expect(out[3]).toMatchObject({ high: 12, low: 10 });
    });
    test('unsorted input comes back ascending', () => {
        expect(v.candles([c(0), c(2), c(1)], H, NOW).map((r) => r.time)).toEqual([t0 - 7200, t0 - 3600, t0]);
    });
    test('stale last candle throws a fallbackable StaleError unless allowStale; fresh passes; empty -> []', () => {
        const old = [c(4)];
        expect(() => v.candles(old, H, NOW)).toThrow(v.StaleError);
        try { v.candles(old, H, NOW); } catch (e) { expect(fallbackable(e)).toBe(true); }
        expect(v.candles(old, H, NOW, { allowStale: true })).toHaveLength(1);
        expect(v.candles([c(2)], H, NOW)).toHaveLength(1);
        expect(v.candles([c(1, { close: NaN })], H, NOW)).toEqual([]);
    });
    test('daily interval tolerates 3 days', () => {
        const D = 86400e3;
        const d = (days) => ({ time: (Math.floor(NOW / D) * D) / 1000 - days * 86400, open: 1, high: 1, low: 1, close: 1, volume: 1 });
        expect(v.candles([d(2)], D, NOW)).toHaveLength(1);
        expect(() => v.candles([d(4)], D, NOW)).toThrow(v.StaleError);
    });
});

describe('validate.series', () => {
    test('finite >0 only, sorted, one row per ts (last wins)', () => {
        const out = v.series([{ ts: 3, oiUsd: 1 }, { ts: 1, oiUsd: NaN }, { ts: 2, oiUsd: 0 }, { ts: 3, oiUsd: 7 }, { ts: 0.5, oiUsd: 2 }], 'oiUsd');
        expect(out).toEqual([{ ts: 0.5, oiUsd: 2 }, { ts: 3, oiUsd: 7 }]);
    });
    test('funding rate keeps zero and negatives, drops non-finite', () => {
        expect(v.series([{ ts: 2, rate: -0.1 }, { ts: 1, rate: 0 }, { ts: 3, rate: NaN }], 'rate').map((r) => r.ts)).toEqual([1, 2]);
    });
});
