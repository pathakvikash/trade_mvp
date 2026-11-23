// Gateway controller + registry with fake providers (no axios).
const logger = require('../config/logger');
const { create } = require('../services/marketData');

const NOW = 1e12;
const H = 3600;
const slot = Math.floor(NOW / 1000 / H) * H;
const row = (t, o = 1) => ({ time: t, open: o, high: o + 1, low: o - 0.5, close: o + 0.5, volume: 3 });
const net = () => new Error('ECONNRESET'); // no response: a network error
const api = () => Object.assign(new Error('api error'), { response: { status: 200 } }); // API-level failure: never trips a breaker
const mk = (name, fns, extra = {}) => {
    const calls = [];
    const p = { name, has: new Set(Object.keys(fns).filter((k) => k !== 'instruments')), ...extra };
    for (const [k, f] of Object.entries(fns)) p[k] = (...a) => { calls.push([k, ...a]); return f(...a); };
    p.calls = calls;
    return p;
};
const chainOf = (...ps) => ({ klines: ps, funding: ps, oiHist: ps, pair: ps });

beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    // the chain ends at the Binance spot mirror: answer 400 (perp-only symbol) instead of touching the network
    jest.spyOn(require('axios'), 'get').mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 400, data: {} } }));
});
afterEach(() => jest.restoreAllMocks());

describe('validation inside the chain', () => {
    test('dirty rows are cleaned; a stale last candle hands over to the next provider', async () => {
        const dirty = mk('aa', { klines: async () => [row(slot - H, 2), row(slot, 2), { ...row(slot), close: 3 }, { ...row(slot - 2 * H), open: 0 }, { ...row(slot + 10 * H) }, { ...row(slot - 3 * H), volume: -1, high: 0.1 }] });
        const gd = create([dirty], chainOf(dirty));
        const k = await gd.first('klines', 'XUSDT', '1h', 10);
        expect(k.source).toBe('aa');
        expect(k.map((c) => c.time)).toEqual([slot - 3 * H, slot - H, slot]); // open<=0 dropped, future dropped, dedupe keeps the last
        expect(k[2].close).toBe(3);
        expect(k[0]).toMatchObject({ volume: 0, high: 1.5 }); // negative volume -> 0, high clamped to >= open/close

        const stale = mk('old', { klines: async () => [row(slot - 10 * H)] });
        const good = mk('new', { klines: async () => [row(slot)] });
        const c = create([stale, good], chainOf(stale, good));
        const r = await c.first('klines', 'XUSDT', '1h', 5);
        expect(r.source).toBe('new');
        expect(stale.calls).toHaveLength(1);
        const empty = mk('e', { klines: async () => [] });
        expect((await create([empty, good], chainOf(empty, good)).first('klines', 'XUSDT', '1h', 5)).source).toBe('new');
    });

    test('series are cleaned and funding keeps negative rates', async () => {
        const p = mk('f', { funding: async () => [{ ts: 2, rate: -0.1 }, { ts: 1, rate: 0.2 }, { ts: 1, rate: 0.3 }, { ts: 3, rate: NaN }] });
        const f = await create([p], chainOf(p)).first('funding', 'XUSDT', 100);
        expect(f).toEqual([{ ts: 1, rate: 0.3 }, { ts: 2, rate: -0.1 }]);
    });
});

describe('registry', () => {
    const list = (...syms) => async () => syms.map((s) => ({ symbol: s, mult: 10 }));

    test('a provider whose list lacks the symbol gets zero capability calls', async () => {
        const a = mk('listed', { klines: async () => [row(slot)], instruments: list('BTCUSDT') });
        const b = mk('other', { klines: async () => [row(slot)], instruments: list('SKYAIUSDT') });
        const c = create([a, b], chainOf(a, b));
        expect((await c.first('klines', 'SKYAIUSDT', '1h', 5)).source).toBe('other');
        expect(a.calls.filter(([k]) => k === 'klines')).toHaveLength(0);
        expect(a.calls.filter(([k]) => k === 'instruments')).toHaveLength(1);
        await c.first('klines', 'SKYAIUSDT', '1h', 5);
        expect(a.calls.filter(([k]) => k === 'instruments')).toHaveLength(1); // list cached 1h
    });

    test('a failed refresh keeps the last good list; retry after 60 s, not before', async () => {
        let fail = false;
        const p = mk('p', { klines: async () => [row(slot)], instruments: async () => { if (fail) throw api(); return [{ symbol: 'AAAUSDT', mult: 1 }]; } });
        const c = create([p], chainOf(p));
        expect((await c.first('klines', 'AAAUSDT', '1h', 5)).source).toBe('p');
        fail = true;
        Date.now.mockReturnValue(NOW + 3600e3 + 1);
        expect((await c.first('klines', 'AAAUSDT', '1h', 5)).source).toBe('p'); // refresh failed, old list still answers
        expect((await c.first('klines', 'ZZZUSDT', '1h', 5)).length).toBe(0); // and still says "not listed" (not regex-open)
        const n = p.calls.filter(([k]) => k === 'instruments').length;
        expect(n).toBe(2);
        await c.first('klines', 'AAAUSDT', '1h', 5);
        expect(p.calls.filter(([k]) => k === 'instruments')).toHaveLength(n); // within the 60 s retry window
        Date.now.mockReturnValue(NOW + 3600e3 + 61e3);
        await c.first('klines', 'AAAUSDT', '1h', 5);
        expect(p.calls.filter(([k]) => k === 'instruments')).toHaveLength(n + 1);
    });

    test('list never loaded: the provider is still tried; mult comes from the single contract, never guessed', async () => {
        const p = mk('g', {
            klines: async (sym, iv, limit, mult) => (mult > 0 ? [row(slot)].map((r) => ({ ...r, volume: 100 * mult })) : []),
            instruments: async () => { throw api(); },
        }, { needsMult: true, contract: async (s) => ({ symbol: s, mult: 10 }) });
        const c = create([p], chainOf(p));
        const k = await c.first('klines', 'SKYAIUSDT', '1h', 5);
        expect(k.source).toBe('g');
        expect(k[0].volume).toBe(1000); // mult passed as the LAST argument
        expect(p.calls.find(([f]) => f === 'klines').slice(1)).toEqual(['SKYAIUSDT', '1h', 5, 10]);
        // no contract endpoint answer either -> no mult -> the provider is asked with undefined and answers []
        const q = mk('g2', { klines: async (s, i, l, mult) => (mult > 0 ? [row(slot)] : []), instruments: async () => { throw api(); } }, { needsMult: true, contract: async () => { throw api(); } });
        expect((await create([q], chainOf(q)).first('klines', 'SKYAIUSDT', '1h', 5)).source).toBe('unavailable');
    });

    test('list loaded: mult taken from it, no single-contract request', async () => {
        const p = mk('g', { klines: async (s, i, l, mult) => [row(slot)].map((r) => ({ ...r, volume: mult })), instruments: list('SKYAIUSDT') }, { needsMult: true, contract: jest.fn() });
        const k = await create([p], chainOf(p)).first('klines', 'SKYAIUSDT', '1h', 5);
        expect(k[0].volume).toBe(10);
        expect(p.contract).not.toHaveBeenCalled();
    });
});

describe('G6: budget and background refresh', () => {
    test('a chain over the 15 s budget skips the remaining providers (one warning)', async () => {
        const slow = mk('slow', { klines: async () => { Date.now.mockReturnValue(NOW + 16e3); throw api(); } });
        const next = mk('next', { klines: async () => [row(slot)] });
        const c = create([slow, next], chainOf(slow, next));
        const k = await c.first('klines', 'XUSDT', '1h', 5);
        expect(next.calls).toHaveLength(0);
        expect(k.source).toBe('unavailable'); // spot answers 400 in this suite
        expect(logger.warn.mock.calls.filter(([m]) => /budget/.test(m))).toHaveLength(1);
    });

    test('an expired list is refreshed in the background: the request is served from the old list and never waits', async () => {
        let hang = false;
        const p = mk('p', { klines: async () => [row(slot)], instruments: () => (hang ? new Promise(() => {}) : Promise.resolve([{ symbol: 'AAAUSDT', mult: 1 }])) });
        const c = create([p], chainOf(p));
        await c.first('klines', 'AAAUSDT', '1h', 5);
        hang = true;
        Date.now.mockReturnValue(NOW + 3600e3 + 1);
        expect((await c.first('klines', 'AAAUSDT', '1h', 5)).source).toBe('p'); // would hang forever if the refresh were awaited
        expect(p.calls.filter(([k]) => k === 'instruments')).toHaveLength(2);
    });
});

describe('pair', () => {
    const oi = (n) => Array.from({ length: n }, (_, i) => ({ ts: (slot - (n - 1 - i) * H) * 1000, oiUsd: 100 + i, oi: 1 }));
    test('candles and OI come from the same provider, both non-empty', async () => {
        const a = mk('a', { klines: async () => [row(slot)], oiHist: async () => [] });
        const b = mk('b', { klines: async () => [row(slot - H), row(slot)], oiHist: async () => oi(2) });
        const r = await create([a, b], chainOf(a, b)).pair('XUSDT', '1h', 5, 6);
        expect(r.source).toBe('b');
        expect(r.oiHist).toEqual([{ ts: (slot - H) * 1000, oiUsd: 100 }, { ts: slot * 1000, oiUsd: 101 }]);
        expect(r.candles).toHaveLength(2);
        expect(await create([a], chainOf(a)).pair('XUSDT', '1h', 5, 6)).toBeNull();
    });
});

describe('breakers of third-party providers', () => {
    const err = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status, headers: {}, data: {} } });
    test('network error trips; blocked for 5 min with zero calls; one probe; success closes', async () => {
        let mode = 'net';
        const p = mk('t', { funding: async () => { if (mode === 'net') throw net(); if (mode === '4xx') throw err(404); return [{ ts: 1, rate: 0.1 }]; } });
        const c = create([p], chainOf(p));
        await expect(c.first('funding', 'XUSDT', 10)).rejects.toThrow('ECONNRESET');
        expect(c.breakers.t.state().state).toBe('open');
        await c.first('funding', 'XUSDT', 10).catch(() => {});
        expect(p.calls).toHaveLength(1); // short-circuited
        Date.now.mockReturnValue(NOW + 301e3);
        const probes = await Promise.all([1, 2, 3].map(() => c.first('funding', 'XUSDT', 10).catch(() => null)));
        expect(p.calls).toHaveLength(2); // exactly one probe (it failed: still open)
        expect(probes.every((x) => x === null)).toBe(true);
        mode = 'ok';
        Date.now.mockReturnValue(NOW + 700e3);
        expect((await c.first('funding', 'XUSDT', 10)).source).toBe('t');
        expect(c.breakers.t.state().state).toBe('closed');
        expect(c.health()[0]).toMatchObject({ name: 't', assetClass: 'crypto', breaker: { state: 'closed' }, listed: null });
    });

    test('an API-level error (status 200) does not trip; a 4xx probe closes', async () => {
        const p = mk('t', { funding: async () => { throw err(200); } });
        const c = create([p], chainOf(p));
        await c.first('funding', 'XUSDT', 10).catch(() => {});
        await c.first('funding', 'XUSDT', 10).catch(() => {});
        expect(p.calls).toHaveLength(2);
        expect(c.breakers.t.state().state).toBe('closed');
    });

    test('health() carries no URLs, env values or error bodies', () => {
        const j = JSON.stringify(require('../services/marketData').health());
        expect(j).not.toMatch(/http|api\.|key|secret/i);
        expect(JSON.parse(j).map((r) => r.name)).toEqual(['binance', 'bybit', 'bitget', 'gate', 'mexc']);
    });
});
