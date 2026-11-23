const axios = require('axios');
const mexc = require('../services/marketData/providers/mexc');

afterEach(() => jest.restoreAllMocks());
const ok = (data) => Promise.resolve({ data: { success: true, code: 0, data } });
const stub = (map) => jest.spyOn(axios, 'get').mockImplementation((u, o) => {
    const k = Object.keys(map).find((p) => u.includes(p));
    return k ? map[k](o.params) : Promise.reject(new Error(`unexpected ${u}`));
});
const col = (n) => ({
    time: Array.from({ length: n }, (_, i) => 1000 + i * 60), open: Array(n).fill(1), high: Array(n).fill(2), low: Array(n).fill(0.5),
    close: Array(n).fill(1.5), vol: Array.from({ length: n }, (_, i) => i + 1), amount: Array(n).fill(0),
});

test('klines: columnar zip, volume = vol * contractSize, Min60 interval, start/end window', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1e12);
    const get = stub({ '/kline/SKYAI_USDT': () => ok(col(2)) });
    expect(await mexc.klines('SKYAIUSDT', '1h', 2, 10)).toEqual([
        { time: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
        { time: 1060, open: 1, high: 2, low: 0.5, close: 1.5, volume: 20 },
    ]);
    expect(get.mock.calls[0][1].params).toEqual({ interval: 'Min60', start: 1e9 - 2 * 3600, end: 1e9 });
    expect(get.mock.calls[0][1].headers['User-Agent']).toBeTruthy();
});

test('slices to limit (keeps the newest) and maps every interval', async () => {
    const get = stub({ '/kline/': () => ok(col(5)) });
    const k = await mexc.klines('AUSDT', '4h', 3, 1);
    expect(k.map((r) => r.volume)).toEqual([3, 4, 5]);
    for (const iv of ['1m', '5m', '15m', '1d']) await mexc.klines('AUSDT', iv, 1, 1);
    expect(get.mock.calls.map(([, o]) => o.params.interval)).toEqual(['Hour4', 'Min1', 'Min5', 'Min15', 'Day1']);
});

test('no mult / unsupported interval -> [] with no request', async () => {
    const get = stub({});
    expect(await mexc.klines('A', '1h', 5)).toEqual([]);
    expect(await mexc.klines('A', '2h', 5, 1)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
});

test('unknown contract (code 1001) -> []; other failures throw with status 200; network throws', async () => {
    stub({ '/kline/': () => Promise.resolve({ data: { success: false, code: 1001, message: 'Contract does not exist' } }), '/funding_rate/history': () => Promise.resolve({ data: { success: false, code: 1001 } }) });
    expect(await mexc.klines('NOPEUSDT', '1h', 5, 1)).toEqual([]);
    expect(await mexc.funding('NOPEUSDT', 5)).toEqual([]);
    axios.get.mockResolvedValue({ data: { success: false, code: 500, message: 'x' } });
    await expect(mexc.klines('A', '1h', 5, 1)).rejects.toMatchObject({ response: { status: 200 } });
    axios.get.mockRejectedValue(new Error('timeout'));
    await expect(mexc.funding('A', 5)).rejects.toThrow('timeout');
});

test('funding and instruments', async () => {
    stub({
        '/funding_rate/history': () => ok({ resultList: [{ fundingRate: 0.000042, settleTime: 2000 }, { fundingRate: -0.1, settleTime: 1000 }] }),
        '/detail': () => ok([
            { symbol: 'SKYAI_USDT', state: 0, quoteCoin: 'USDT', contractSize: 10 },
            { symbol: 'OLD_USDT', state: 1, quoteCoin: 'USDT', contractSize: 1 },
            { symbol: 'BTC_USD', state: 0, quoteCoin: 'USD', contractSize: 1 },
        ]),
    });
    expect(await mexc.funding('BTCUSDT', 2)).toEqual([{ ts: 1000, rate: -0.1 }, { ts: 2000, rate: 0.000042 }]);
    expect(await mexc.instruments()).toEqual([{ symbol: 'SKYAIUSDT', mult: 10 }]);
    expect([...mexc.has].sort()).toEqual(['funding', 'klines']);
});

test('G5: HTTP-200 {success:false, code:510|429} throttling surfaces as response.status 429 and trips a breaker; other codes stay 200', async () => {
    jest.spyOn(require('../config/logger'), 'info').mockImplementation(() => {});
    const { breaker } = require('../services/marketData/breaker');
    for (const code of [510, 429]) {
        stub({ '/kline/': () => Promise.resolve({ data: { success: false, code, message: 'too frequent' } }) });
        const e = await mexc.klines('AUSDT', '1h', 5, 1).catch((x) => x);
        expect(e.response.status).toBe(429);
        const b = breaker('mexc-t', { level: 'info' });
        await b.run(() => Promise.reject(e)).catch(() => {});
        expect(b.state().state).toBe('open');
    }
    stub({ '/kline/': () => Promise.resolve({ data: { success: false, code: 600, message: 'bad' } }) });
    expect((await mexc.klines('AUSDT', '1h', 5, 1).catch((x) => x)).response.status).toBe(200);
});
