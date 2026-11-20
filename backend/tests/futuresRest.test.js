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
