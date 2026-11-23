const axios = require('axios');
const gate = require('../services/marketData/providers/gate');

afterEach(() => { jest.restoreAllMocks(); require('../services/marketData/cache').clear(); });
const stub = (map) => jest.spyOn(axios, 'get').mockImplementation((u, o) => {
    const k = Object.keys(map).find((p) => u.endsWith(p));
    return k ? Promise.resolve({ data: map[k](o.params) }) : Promise.reject(new Error(`unexpected ${u}`));
});
const stat = (time, o = {}) => ({
    time, open_interest: 2787208, open_interest_usd: 1018724.524, lsr_taker: 0.83, lsr_account: 1.218, top_lsr_size: 0.938,
    top_long_size: 1219637, top_short_size: 1299665, long_taker_size: 9373, short_taker_size: 11266, long_users: 324, short_users: 266, ...o,
});

test('klines: volume = contracts * mult (v 4622, mult 10 -> 46220), SKYAIUSDT -> SKYAI_USDT, ascending', async () => {
    const get = stub({ '/candlesticks': () => [{ t: 2000, o: '2', h: '3', l: '1', c: '2.5', v: 4622, sum: '1' }, { t: 1000, o: '1', h: '2', l: '1', c: '2', v: 1, sum: '1' }] });
    const k = await gate.klines('SKYAIUSDT', '1h', 5, 10);
    expect(k).toEqual([
        { time: 1000, open: 1, high: 2, low: 1, close: 2, volume: 10 },
        { time: 2000, open: 2, high: 3, low: 1, close: 2.5, volume: 46220 },
    ]);
    expect(get.mock.calls[0][1].params).toEqual({ contract: 'SKYAI_USDT', interval: '1h', limit: 5 });
    expect(get.mock.calls[0][1].headers['User-Agent']).toBeTruthy();
    expect(get.mock.calls[0][1].timeout).toBe(4000);
});

test('never guesses mult: no mult -> klines/taker [] without a request; oiHist omits oi', async () => {
    const get = stub({ '/candlesticks': () => [], '/contract_stats': () => [stat(1000)] });
    expect(await gate.klines('A_USDT', '1h', 5)).toEqual([]);
    expect(await gate.klines('AUSDT', '1h', 5, 0)).toEqual([]);
    expect(await gate.taker('AUSDT', '1h', 5)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(await gate.oiHist('AUSDT', '1h', 5)).toEqual([{ ts: 1000000, oiUsd: 1018724.524 }]);
});

test('contract_stats mapping: oiUsd == open_interest_usd, oi in base, dedupe by ts, ascending', async () => {
    const get = stub({ '/contract_stats': () => [stat(2000), stat(1000), stat(2000, { open_interest_usd: 5 })] });
    const oi = await gate.oiHist('SKYAIUSDT', '1h', 100, 10);
    expect(oi).toEqual([{ ts: 1000000, oi: 27872080, oiUsd: 1018724.524 }, { ts: 2000000, oi: 27872080, oiUsd: 5 }]);
    expect(get.mock.calls[0][1].params).toEqual({ contract: 'SKYAI_USDT', interval: '1h', limit: 100 });
});

test('ratio, topRatio, taker mapping; empty forming taker bucket skipped', async () => {
    stub({ '/contract_stats': () => [stat(1000), stat(2000, { lsr_taker: 0, long_taker_size: 0, short_taker_size: 0 })] });
    const [r] = await gate.ratio('SKYAIUSDT', '1h', 5);
    expect(r).toEqual({ ts: 1000000, ratio: 1.218, longPct: 54.9153, shortPct: 45.0847 });
    const [t] = await gate.topRatio('SKYAIUSDT', '1h', 5);
    expect(t.ratio).toBe(0.938);
    expect(t.longPct + t.shortPct).toBeCloseTo(100, 3);
    expect(await gate.taker('SKYAIUSDT', '1h', 5, 10)).toEqual([{ ts: 1000000, ratio: 0.83, buyVol: 93730, sellVol: 112660 }]);
});

test('unsupported period/interval -> []; limit capped at 1000/2000', async () => {
    const get = stub({ '/contract_stats': () => [], '/candlesticks': () => [] });
    expect(await gate.oiHist('A', '1d', 5, 1)).toEqual([]);
    expect(await gate.klines('A', '3m', 5, 1)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    await gate.oiHist('A', '5m', 5000, 1);
    await gate.klines('A', '5m', 5000, 1);
    expect(get.mock.calls.map(([, o]) => o.params.limit)).toEqual([1000, 2000]);
});

test('unknown contract (400 CONTRACT_NOT_FOUND) -> []; other errors throw', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { label: 'CONTRACT_NOT_FOUND' } } }));
    expect(await gate.klines('NOPEUSDT', '1h', 5, 1)).toEqual([]);
    expect(await gate.funding('NOPEUSDT', 5)).toEqual([]);
    expect(await gate.ratio('NOPEUSDT', '1h', 5)).toEqual([]);
    axios.get.mockRejectedValue(Object.assign(new Error('500'), { response: { status: 500, data: {} } }));
    await expect(gate.funding('A', 5)).rejects.toThrow('500');
});

test('funding and instruments', async () => {
    stub({
        '/funding_rate': () => [{ r: '0.0000355', t: 2 }, { r: '0.0000108', t: 1 }],
        '/contracts': () => [
            { name: 'SKYAI_USDT', status: 'trading', in_delisting: false, quanto_multiplier: '10' },
            { name: 'OLD_USDT', status: 'trading', in_delisting: true, quanto_multiplier: '1' },
            { name: 'X_USDT', status: 'delisted', quanto_multiplier: '1' },
        ],
    });
    expect(await gate.funding('BTCUSDT', 2)).toEqual([{ ts: 1000, rate: 0.0000108 }, { ts: 2000, rate: 0.0000355 }]);
    expect(await gate.instruments()).toEqual([{ symbol: 'SKYAIUSDT', mult: 10 }]);
});

test('G6: the four contract_stats-based calls of one chart load share ONE request (5 s cache)', async () => {
    const get = stub({ '/contract_stats': () => [stat(1000)] });
    await Promise.all([gate.oiHist('AUSDT', '1h', 100, 1), gate.ratio('AUSDT', '1h', 100), gate.topRatio('AUSDT', '1h', 100), gate.taker('AUSDT', '1h', 100, 1)]);
    expect(get).toHaveBeenCalledTimes(1);
});
