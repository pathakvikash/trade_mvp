const axios = require('axios');
const rest = require('../services/futuresRest');

const info = (symbols) => ({ data: { symbols } });
const sym = (symbol, o = {}) => ({ symbol, status: 'TRADING', contractType: 'PERPETUAL', quoteAsset: 'USDT', ...o });

beforeEach(() => rest._test.reset());
afterEach(() => jest.restoreAllMocks());

test('isKnownSymbol: regex-only fallback when exchangeInfo has never succeeded', async () => {
    const get = jest.spyOn(axios, 'get').mockRejectedValue(new Error('down'));
    expect(await rest.isKnownSymbol('FOOUSDT')).toBe(true); // well-formed, cannot verify
    expect(await rest.isKnownSymbol('bad')).toBe(false); // regex still applies
    expect(get).toHaveBeenCalledTimes(1); // failure is not retried on every call
});

test('isKnownSymbol: only TRADING USDT perpetuals; failed refresh keeps the last good set', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue(info([
        sym('BTCUSDT'), sym('OLDUSDT', { status: 'BREAK' }), sym('BTCUSDT_261225', { contractType: 'CURRENT_QUARTER' }), sym('BTCUSDC', { quoteAsset: 'USDC' }),
    ]));
    expect(await rest.isKnownSymbol('BTCUSDT')).toBe(true);
    expect(await rest.isKnownSymbol('OLDUSDT')).toBe(false);
    expect(await rest.isKnownSymbol('FOOUSDT')).toBe(false);
    expect(get).toHaveBeenCalledTimes(1); // cached

    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 3600e3 + 1);
    get.mockRejectedValue(new Error('down'));
    expect(await rest.isKnownSymbol('BTCUSDT')).toBe(true);
    expect(await rest.isKnownSymbol('FOOUSDT')).toBe(false); // still the old set, not regex fallback
    expect(get).toHaveBeenCalledTimes(2);
    spy.mockRestore();
});

describe('overview fundingIntervalHours', () => {
    const tick = (symbol, v) => ({ symbol, lastPrice: '1', priceChangePercent: '0', highPrice: '1', lowPrice: '1', quoteVolume: v });
    const prem = (symbol) => ({ symbol, markPrice: '1', indexPrice: '1', lastFundingRate: '0.0001', nextFundingTime: 1 });
    const stub = (fundingInfo) => jest.spyOn(axios, 'get').mockImplementation((url) => {
        if (url.endsWith('/ticker/24hr')) return Promise.resolve({ data: [tick('AAAUSDT', '2'), tick('BBBUSDT', '1')] });
        if (url.endsWith('/premiumIndex')) return Promise.resolve({ data: [prem('AAAUSDT'), prem('BBBUSDT')] });
        if (url.endsWith('/openInterest')) return Promise.resolve({ data: { openInterest: '1' } });
        if (url.endsWith('/fundingInfo')) return fundingInfo();
        return Promise.reject(new Error(`unexpected ${url}`));
    });

    test('merges non-default intervals, defaults the rest to 8', async () => {
        stub(() => Promise.resolve({ data: [{ symbol: 'AAAUSDT', fundingIntervalHours: 4 }] }));
        const rows = await rest.overview();
        expect(rows.map((r) => r.fundingIntervalHours)).toEqual([4, 8]);
    });

    test('fundingInfo failure defaults all to 8 and does not fail the overview', async () => {
        stub(() => Promise.reject(new Error('down')));
        const rows = await rest.overview();
        expect(rows.map((r) => r.fundingIntervalHours)).toEqual([8, 8]);
    });
});

test('listSymbols: sorted [{symbol, base}] of tradable USDT perpetuals', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue(info([sym('ETHUSDT', { baseAsset: 'ETH' }), sym('BTCUSDT', { baseAsset: 'BTC' }), sym('OLDUSDT', { status: 'BREAK' })]));
    expect(await rest.listSymbols()).toEqual([{ symbol: 'BTCUSDT', base: 'BTC' }, { symbol: 'ETHUSDT', base: 'ETH' }]);
});

test('liqheat: pages openInterestHist at 500 rows and shapes the payload', async () => {
    const step = 300e3;
    const t = Math.floor(Date.now() / step) * step;
    const get = jest.spyOn(axios, 'get').mockImplementation((url, { params }) => {
        if (url.endsWith('/klines')) {
            return Promise.resolve({ data: Array.from({ length: params.limit }, (_, i) => [t - (params.limit - 1 - i) * step, '100', '101', '99', '100', '1']) });
        }
        const end = params.endTime || t;
        return Promise.resolve({ data: Array.from({ length: params.limit }, (_, i) => ({ timestamp: end - (params.limit - 1 - i) * step, sumOpenInterestValue: String(1000 + (end - (params.limit - 1 - i) * step) / step) })) });
    });
    const d = await rest.liqheat('BTCUSDT', '24h');
    const oiCalls = get.mock.calls.filter(([u]) => u.includes('openInterestHist'));
    expect(oiCalls.map(([, { params }]) => params.limit)).toEqual([500, 77]); // 2*288+1 rows
    expect(d).toMatchObject({ symbol: 'BTCUSDT', range: '24h', cols: 288, rows: 120, method: 'oi-delta-leverage-tiers', leverages: [5, 8, 10, 15, 20, 25, 33, 50, 75, 100, 125], mmr: 0.004 });
    expect(d).not.toHaveProperty('tiers');
    expect(d.outOfViewUsd).toBeGreaterThanOrEqual(0);
    expect(d.cells).toHaveLength(288 * 120);
    expect(d.candles).toHaveLength(288);
    expect(d.totals.longUsd + d.totals.shortUsd).toBeGreaterThan(0);
});

test('liqheat: separate cache holds at most 40 entries', async () => {
    jest.spyOn(axios, 'get').mockImplementation((url, { params }) => (url.endsWith('/klines')
        ? Promise.resolve({ data: Array.from({ length: params.limit }, (_, i) => [Date.now() - (params.limit - i) * 300e3, '100', '101', '99', '100', '1']) })
        : Promise.resolve({ data: [] })));
    const first = rest.liqheat('S0USDT', '12h');
    await first;
    for (let i = 1; i <= 40; i++) await rest.liqheat(`S${i}USDT`, '12h');
    const calls = axios.get.mock.calls.length;
    expect(rest.liqheat('S40USDT', '12h')).toBeInstanceOf(Promise);
    expect(axios.get.mock.calls.length).toBe(calls); // newest still cached
    await rest.liqheat('S0USDT', '12h');
    expect(axios.get.mock.calls.length).toBeGreaterThan(calls); // oldest was evicted
});

describe('markPrice', () => {
    test('returns {markPrice, ts} for one symbol, cached 2s', async () => {
        const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { symbol: 'BTCUSDT', markPrice: '65000.5', time: 123 } });
        expect(await rest.markPrice('BTCUSDT')).toEqual({ markPrice: 65000.5, ts: 123 });
        await rest.markPrice('BTCUSDT');
        expect(get).toHaveBeenCalledTimes(1);
        expect(get.mock.calls[0][0]).toMatch(/\/fapi\/v1\/premiumIndex$/);
        expect(get.mock.calls[0][1].params).toEqual({ symbol: 'BTCUSDT' });
    });
    test('null on failure, unknown symbol or garbage; never rejects; failure is not cached', async () => {
        const get = jest.spyOn(axios, 'get').mockRejectedValue(new Error('down'));
        expect(await rest.markPrice('BTCUSDT')).toBeNull();
        get.mockResolvedValue({ data: { markPrice: '5', time: 1 } });
        expect(await rest.markPrice('BTCUSDT')).toEqual({ markPrice: 5, ts: 1 });
        expect(await rest.markPrice('bad')).toBeNull();
        get.mockResolvedValue({ data: { markPrice: 'x' } });
        expect(await rest.markPrice('ETHUSDT')).toBeNull();
        get.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { code: -1121 } } }));
        expect(await rest.markPrice('NOPEUSDT')).toBeNull();
    });
});

// ---- blocked-REST fallbacks + circuit breaker ----
describe('fallbacks and breaker', () => {
    const logger = require('../config/logger');
    const err = (status, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, headers, data: {} } });
    const FAPI = (u) => u.includes('fapi.binance.com') || u.includes('/fapi/') || u.includes('/futures/data/');
    const kl = [[1000, '1', '2', '0.5', '1.5', '10', 1999, '15', 3, '5', '7', '0']];
    const feed = () => {
        rest.ingestTickers([{ s: 'AAAUSDT', c: '110', o: '100', h: '120', l: '90', q: '500' }, { s: 'BBBUSDT', c: '5', o: '0', h: '6', l: '4', q: '900' }, { s: 'ZZZ', c: '1', o: '1', h: '1', l: '1', q: '1' }]);
        rest.ingestMarks([{ s: 'AAAUSDT', p: '109.5', i: '109', r: '0.0001', T: 77 }, { s: 'BBBUSDT', p: '5.1', i: '5', r: '0', T: 78 }]);
    };
    let warn;
    beforeEach(() => { warn = jest.spyOn(logger, 'warn').mockImplementation(() => {}); });

    test('REST ok: outputs unchanged, spot never called, no source', async () => {
        const get = jest.spyOn(axios, 'get').mockImplementation((u) => Promise.resolve({ data: u.endsWith('/klines') ? kl : u.endsWith('exchangeInfo') ? { symbols: [sym('BTCUSDT', { baseAsset: 'BTC' })] } : [] }));
        const k = await rest.klines('BTCUSDT', '1m', 5);
        expect(k).toEqual([require('../services/futuresUtils').normalizeRestKline(kl[0])]);
        expect(k.source).toBeUndefined();
        expect(await rest.listSymbols()).toEqual([{ symbol: 'BTCUSDT', base: 'BTC' }]);
        expect(get.mock.calls.some(([u]) => u.includes('binance.vision'))).toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });

    test('418 overview with live caches: rows from WS carry ts, source ws', async () => {
        jest.spyOn(axios, 'get').mockRejectedValue(err(418));
        feed();
        const rows = await rest.overview();
        expect(rows.source).toBe('ws');
        expect(rows.map((r) => r.symbol)).toEqual(['BBBUSDT', 'AAAUSDT']); // by quote volume; ZZZ invalid, skipped
        expect(rows[1]).toMatchObject({ lastPrice: 110, priceChangePercent: 10, high: 120, low: 90, quoteVolume: 500, markPrice: 109.5, indexPrice: 109, fundingRate: 0.0001, nextFundingTime: 77, fundingIntervalHours: null, openInterestUsd: null });
        expect(Date.now() - rows[1].ts).toBeLessThan(1000);
    });

    test('overview with empty WS caches rethrows (502 as today)', async () => {
        jest.spyOn(axios, 'get').mockRejectedValue(err(418));
        await expect(rest.overview()).rejects.toMatchObject({ response: { status: 418 } });
    });

    test('418 klines -> spot mirror, normalized, source spot', async () => {
        const get = jest.spyOn(axios, 'get').mockImplementation((u) => (u.includes('binance.vision') ? Promise.resolve({ data: kl }) : Promise.reject(err(418))));
        const k = await rest.klines('BTCUSDT', '1m', 5);
        expect(k.source).toBe('spot');
        expect(k).toHaveLength(1);
        const spot = get.mock.calls.find(([u]) => u.includes('binance.vision'));
        expect(spot[0]).toMatch(/\/api\/v3\/klines$/);
        expect(spot[1].params).toEqual({ symbol: 'BTCUSDT', interval: '1m', limit: 5 });
    });

    test('spot -1121 (perp-only symbol) -> [] unavailable, not an error; spot failure is logged once', async () => {
        const spotErr = Object.assign(new Error('bad'), { response: { status: 400, data: { code: -1121 } } });
        jest.spyOn(axios, 'get').mockImplementation((u) => Promise.reject(u.includes('binance.vision') ? spotErr : err(418)));
        const k = await rest.klines('PERPUSDT', '1m', 5);
        expect([...k]).toEqual([]);
        expect(k.source).toBe('unavailable');
        axios.get.mockImplementation((u) => Promise.reject(u.includes('binance.vision') ? new Error('spot down') : err(418)));
        await expect(rest.klines('A1USDT', '1m', 5)).rejects.toBeTruthy();
        await expect(rest.klines('A2USDT', '1m', 5)).rejects.toBeTruthy();
        expect(warn.mock.calls.filter(([m]) => /spot fallback failed/.test(m))).toHaveLength(1);
    });

    test('400 from fapi passes through (no fallback, no trip)', async () => {
        const get = jest.spyOn(axios, 'get').mockRejectedValue(err(400));
        await expect(rest.klines('XUSDT', '1m', 5)).rejects.toMatchObject({ response: { status: 400 } });
        expect(get).toHaveBeenCalledTimes(1);
        await expect(rest.klines('YUSDT', '1m', 5)).rejects.toBeTruthy();
        expect(get).toHaveBeenCalledTimes(2); // still calling fapi
    });

    test('stats: all blocked -> empty series + degraded; one ok -> partial as before', async () => {
        jest.spyOn(axios, 'get').mockRejectedValue(err(418));
        const d = await rest.stats('BTCUSDT', '1h');
        expect(d).toEqual({ symbol: 'BTCUSDT', period: '1h', openInterest: [], longShort: [], topLongShort: [], takerBuySell: [], funding: [], degraded: true, source: 'unavailable' });
        rest._test.reset();
        axios.get.mockImplementation((u) => (u.endsWith('/fundingRate') ? Promise.resolve({ data: [{ fundingTime: 1, fundingRate: '0.1' }] }) : Promise.reject(err(500))));
        const p = await rest.stats('BTCUSDT', '1h');
        expect(p.funding).toEqual([{ ts: 1, rate: 0.1 }]);
        expect(p.degraded).toBeUndefined();
        rest._test.reset();
        axios.get.mockRejectedValue(err(500)); // plain outage: still 502 as today
        await expect(rest.stats('BTCUSDT', '1h')).rejects.toBeTruthy();
    });

    test('listSymbols falls back to ticker-stream keys when exchangeInfo never loaded', async () => {
        jest.spyOn(axios, 'get').mockRejectedValue(err(418));
        await expect(rest.listSymbols()).rejects.toThrow('symbol list unavailable');
        feed();
        const l = await rest.listSymbols();
        expect([...l]).toEqual([{ symbol: 'AAAUSDT', base: 'AAA' }, { symbol: 'BBBUSDT', base: 'BBB' }]);
        expect(l.source).toBe('ws');
    });

    describe('breaker', () => {
        let now;
        let get;
        beforeEach(() => {
            now = 1e12;
            jest.spyOn(Date, 'now').mockImplementation(() => now);
            get = jest.spyOn(axios, 'get').mockImplementation((u) => Promise.reject(u.includes('binance.vision') ? new Error('x') : err(418)));
        });
        const fapiCalls = () => get.mock.calls.filter(([u]) => FAPI(u)).length;
        const trip = async () => { await rest.klines('T0USDT', '1m', 1).catch(() => {}); };

        test('after a 418, calls short-circuit with zero axios calls; warns once', async () => {
            await trip();
            expect(fapiCalls()).toBe(1);
            for (let i = 1; i <= 5; i++) await rest.klines(`T${i}USDT`, '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(1);
            expect(warn.mock.calls.filter(([m]) => /blocked \(HTTP 418\), using fallbacks for 300s/.test(m))).toHaveLength(1);
        });

        test('after 300s exactly one probe goes out, also under concurrency; ok closes, fail reopens', async () => {
            await trip();
            now += 301e3;
            await Promise.all([1, 2, 3].map((i) => rest.klines(`C${i}USDT`, '1m', 1).catch(() => {})));
            expect(fapiCalls()).toBe(2); // one probe, failed -> reopened
            await rest.klines('D1USDT', '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(2); // short-circuited again
            now += 301e3;
            get.mockImplementation((u) => Promise.resolve({ data: kl }));
            await rest.klines('E1USDT', '1m', 1); // probe ok -> closed
            await rest.klines('E2USDT', '1m', 1);
            expect(fapiCalls()).toBe(4);
            expect(warn.mock.calls.filter(([m]) => /recovered/.test(m))).toHaveLength(1);
            expect(warn.mock.calls.filter(([m]) => /blocked/.test(m))).toHaveLength(1); // reopen is not a state change
        });

        test('Retry-After longer than 300s is honoured', async () => {
            get.mockRejectedValue(err(429, { 'retry-after': '900' }));
            await trip();
            now += 600e3;
            await rest.klines('R1USDT', '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(1); // still open at 600s
            now += 301e3;
            await rest.klines('R2USDT', '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(2);
        });

        test('429 waits Retry-After (default 60s); 418 keeps the 300s floor even with a short Retry-After', async () => {
            get.mockRejectedValue(err(429));
            await trip();
            now += 61e3;
            await rest.klines('P1USDT', '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(2); // probe after 60s, not 300s
            get.mockRejectedValue(err(429, { 'retry-after': '10' }));
            now += 61e3;
            await rest.klines('P2USDT', '1m', 1).catch(() => {}); // probe 429 again: until = now + 10s
            now += 11e3;
            await rest.klines('P3USDT', '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(4);
            get.mockRejectedValue(err(418, { 'retry-after': '30' }));
            now += 11e3;
            await rest.klines('P4USDT', '1m', 1).catch(() => {}); // probe 418: floor 300s
            now += 60e3;
            await rest.klines('P5USDT', '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(5);
        });

        test('a request started before the trip that then succeeds does not close the breaker', async () => {
            let release;
            get.mockImplementationOnce(() => new Promise((r) => { release = () => r({ data: kl }); }));
            const stale = rest.klines('S1USDT', '1m', 1); // in flight
            await trip(); // someone else gets 418 -> open
            release();
            await stale;
            const before = fapiCalls();
            await rest.klines('S2USDT', '1m', 1).catch(() => {});
            expect(fapiCalls()).toBe(before); // still short-circuited
            expect(warn.mock.calls.filter(([m]) => /recovered/.test(m))).toHaveLength(0);
        });

        test('live WS entries silent for >5 min are pruned from the fallbacks', async () => {
            feed();
            now += 301e3;
            rest.ingestTickers([{ s: 'AAAUSDT', c: '110', o: '100', h: '120', l: '90', q: '500' }]); // AAA still ticking
            rest.ingestMarks([{ s: 'AAAUSDT', p: '109.5', i: '109', r: '0.0001', T: 77 }]);
            const l = await rest.listSymbols();
            expect([...l].map((x) => x.symbol)).toEqual(['AAAUSDT']);
            expect((await rest.overview()).map((r) => r.symbol)).toEqual(['AAAUSDT']);
        });

        test('spot-failure warning re-arms after a successful spot call', async () => {
            await trip();
            await rest.klines('W1USDT', '1m', 1).catch(() => {});
            await rest.klines('W2USDT', '1m', 1).catch(() => {});
            get.mockImplementation((u) => (u.includes('binance.vision') ? Promise.resolve({ data: kl }) : Promise.reject(err(418))));
            expect((await rest.klines('W3USDT', '1m', 1)).source).toBe('spot');
            get.mockImplementation((u) => Promise.reject(u.includes('binance.vision') ? new Error('x') : err(418)));
            await rest.klines('W4USDT', '1m', 1).catch(() => {});
            expect(warn.mock.calls.filter(([m]) => /spot fallback failed/.test(m))).toHaveLength(2);
        });

        test('network error and 500 fall back for that call without tripping', async () => {
            get.mockImplementation((u) => (u.includes('binance.vision') ? Promise.resolve({ data: kl }) : Promise.reject(new Error('ECONNRESET'))));
            expect((await rest.klines('N1USDT', '1m', 1)).source).toBe('spot');
            get.mockImplementation((u) => (u.includes('binance.vision') ? Promise.resolve({ data: kl }) : Promise.reject(err(500))));
            expect((await rest.klines('N2USDT', '1m', 1)).source).toBe('spot');
            const before = fapiCalls();
            await rest.klines('N3USDT', '1m', 1);
            expect(fapiCalls()).toBe(before + 1); // fapi still tried first
            expect(warn).not.toHaveBeenCalled();
        });

        test('open interest refresh is skipped while open', async () => {
            await trip();
            get.mockClear();
            feed();
            const rows = await rest.overview();
            expect(rows.source).toBe('ws');
            expect(get.mock.calls.filter(([u]) => u.endsWith('/openInterest'))).toHaveLength(0);
        });

        test('markPrice falls back to the live WS mark with its receive time', async () => {
            feed();
            expect(await rest.markPrice('AAAUSDT')).toEqual({ markPrice: 109.5, ts: now });
            expect(await rest.markPrice('NOPEUSDT')).toBeNull();
        });
    });
});
