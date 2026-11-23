const axios = require('axios');
const bitget = require('../services/marketData/providers/bitget');

afterEach(() => jest.restoreAllMocks());
const ok = (data) => Promise.resolve({ data: { code: '00000', msg: 'success', data } });
const stub = (map) => jest.spyOn(axios, 'get').mockImplementation((u, o) => {
    const k = Object.keys(map).find((p) => u.endsWith(p));
    return k ? map[k](o.params) : Promise.reject(new Error(`unexpected ${u}`));
});

test('klines: ascending, base volume (not quote), explicit headers/timeout, interval mapped', async () => {
    const get = stub({ '/candles': () => ok([['2000000', '1', '3', '0.5', '2', '768385', '28070'], ['1000000', '1', '2', '1', '1.5', '10', '15']]) });
    const k = await bitget.klines('SKYAIUSDT', '1h', 10);
    expect(k).toEqual([
        { time: 1000, open: 1, high: 2, low: 1, close: 1.5, volume: 10 },
        { time: 2000, open: 1, high: 3, low: 0.5, close: 2, volume: 768385 },
    ]);
    const [url, o] = get.mock.calls[0];
    expect(url).toMatch(/\/candles$/);
    expect(o.params).toEqual({ productType: 'USDT-FUTURES', symbol: 'SKYAIUSDT', granularity: '1H', limit: 10 });
    expect(o.timeout).toBe(4000);
    expect(o.headers['User-Agent']).toBeTruthy();
    expect((await bitget.klines('X', '4h', 1).catch(() => 0)) !== undefined).toBe(true);
    expect(get.mock.calls[1][1].params.granularity).toBe('4H');
});

test('unsupported interval/period: [] with no request', async () => {
    const get = stub({});
    expect(await bitget.klines('A', '2h', 5)).toEqual([]);
    expect(await bitget.ratio('A', '1d', 5)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
});

test('unknown symbol (40034, as 200 body or as HTTP error) and empty ratio (40054) are [] not errors', async () => {
    stub({ '/candles': () => Promise.resolve({ data: { code: '40034', msg: 'Parameter NOPE does not exist', data: null } }) });
    expect(await bitget.klines('NOPEUSDT', '1h', 5)).toEqual([]);
    axios.get.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { code: '40034' } } }));
    expect(await bitget.funding('NOPEUSDT', 5)).toEqual([]);
    axios.get.mockResolvedValue({ data: { code: '40054', msg: 'no data', data: null } });
    expect(await bitget.ratio('SMALLUSDT', '1h', 5)).toEqual([]);
});

test('other API codes and network errors throw; API-level error has status 200 (no breaker trip)', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { code: '40001', msg: 'bad' } });
    await expect(bitget.klines('A', '1h', 5)).rejects.toMatchObject({ response: { status: 200 } });
    axios.get.mockRejectedValue(new Error('timeout'));
    await expect(bitget.klines('A', '1h', 5)).rejects.toThrow('timeout');
});

test('ratio, funding and instruments shapes; ratio sliced to limit', async () => {
    stub({
        '/account-long-short': () => ok([{ longAccountRatio: '0.7734', shortAccountRatio: '0.2266', longShortAccountRatio: '3.413', ts: '2000' }, { longAccountRatio: '0.5', shortAccountRatio: '0.5', longShortAccountRatio: '1', ts: '1000' }]),
        '/history-fund-rate': () => ok([{ fundingRate: '-0.000022', fundingTime: '2000' }, { fundingRate: '0.0001', fundingTime: '1000' }]),
        '/contracts': () => ok([{ symbol: 'BTCUSDT', symbolStatus: 'normal' }, { symbol: 'OLDUSDT', symbolStatus: 'off' }]),
    });
    expect(await bitget.ratio('BTCUSDT', '1h', 1)).toEqual([{ ts: 2000, ratio: 3.413, longPct: 77.34, shortPct: 22.66 }]);
    expect(await bitget.funding('BTCUSDT', 5)).toEqual([{ ts: 1000, rate: 0.0001 }, { ts: 2000, rate: -0.000022 }]);
    expect(await bitget.instruments()).toEqual([{ symbol: 'BTCUSDT', mult: 1 }]);
    expect([...bitget.has].sort()).toEqual(['funding', 'klines', 'ratio']);
});
