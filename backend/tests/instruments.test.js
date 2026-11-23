const axios = require('axios');
const instruments = require('../services/marketData/instruments');
const yahoo = require('../services/marketData/providers/yahoo');

const nowS = () => Math.floor(Date.now() / 1000);
const meta = (o = {}) => ({
    regularMarketPrice: 100, regularMarketChangePercent: 1.5, regularMarketDayHigh: 101, regularMarketDayLow: 99, regularMarketVolume: 10,
    regularMarketTime: nowS(), currentTradingPeriod: { regular: { start: nowS() - 100, end: nowS() + 100 } }, ...o,
});
const sparkBody = (items) => ({ spark: { result: items.map(([symbol, m]) => ({ symbol, response: [{ meta: m }] })) } });
const rej429 = () => Object.assign(new Error('429'), { response: { status: 429, headers: {} } });

let calls;
function stub(handler) {
    calls = [];
    jest.spyOn(axios, 'get').mockImplementation(async (url, opts) => { calls.push({ url, opts }); return { data: handler(url) }; });
}
beforeEach(() => yahoo._test.reset());
afterEach(() => jest.restoreAllMocks());

describe('instruments', () => {
    test('list covers the four categories, stocks include Tata/Aditya Birla (TMPV/TMCV, not TATAMOTORS)', () => {
        for (const c of instruments.CATEGORIES) expect(instruments.list(c).length).toBeGreaterThan(0);
        const syms = instruments.INSTRUMENTS.map((i) => i.symbol);
        expect(syms).toEqual(expect.arrayContaining(['TMPV', 'TMCV', 'TATASTEEL', 'GRASIM', 'ABCAPITAL', 'NIFTY50', 'GOLD', 'USDINR']));
        expect(syms).not.toContain('TATAMOTORS');
        for (const i of instruments.INSTRUMENTS) {
            expect(i.symbol).toMatch(instruments.SYMBOL_RE);
            expect(i).toEqual(expect.objectContaining({ name: expect.any(String), yahoo: expect.any(String), exchange: expect.any(String), currency: expect.any(String) }));
        }
    });
    test('find only accepts allow-listed display symbols, never a raw Yahoo ticker', () => {
        expect(instruments.find('nifty50').yahoo).toBe('^NSEI');
        for (const raw of ['^NSEI', 'GC=F', 'RELIANCE.NS', 'USDINR=X', 'NOPE', '']) expect(instruments.find(raw)).toBeNull();
    });
});

describe('yahoo quotes', () => {
    test('spark call is batched, URL-encodes ^ and =, sends a User-Agent; marketOpen from currentTradingPeriod, null when absent', async () => {
        stub((url) => sparkBody([
            ['^NSEI', meta()],
            ['GC=F', meta({ currentTradingPeriod: undefined })],
            ['RELIANCE.NS', meta({ currentTradingPeriod: { regular: { start: nowS() - 200, end: nowS() - 100 } } })],
        ]));
        const insts = ['NIFTY50', 'GOLD', 'RELIANCE'].map(instruments.find);
        jest.spyOn(instruments, 'list').mockReturnValue(insts);
        const { rows } = await yahoo.quotes('mixed');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/v7/finance/spark?symbols=%5ENSEI,GC%3DF,RELIANCE.NS');
        expect(calls[0].opts.headers['User-Agent']).toMatch(/Mozilla/);
        expect(rows.map((r) => [r.symbol, r.marketOpen])).toEqual([['NIFTY50', true], ['GOLD', null], ['RELIANCE', false]]);
        expect(rows[0]).toEqual(expect.objectContaining({ category: 'index', exchange: 'NSE', currency: 'INR', price: 100, changePct: 1.5 }));
    });

    test('symbols missing from spark fall back to the per-symbol chart call', async () => {
        jest.spyOn(instruments, 'list').mockReturnValue(['GOLD', 'SILVER'].map(instruments.find));
        stub((url) => (url.includes('/spark') ? sparkBody([['GC=F', meta()]]) : { chart: { result: [{ meta: meta({ regularMarketPrice: 30 }) }] } }));
        const { rows } = await yahoo.quotes('fb');
        expect(rows.map((r) => [r.symbol, r.price])).toEqual([['GOLD', 100], ['SILVER', 30]]);
        expect(calls.some((c) => c.url.includes('/v8/finance/chart/SI%3DF'))).toBe(true);
    });

    test('Yahoo 429: lastGood served with stale:true, then 502-material error without any cache', async () => {
        jest.spyOn(instruments, 'list').mockReturnValue([instruments.find('GOLD')]);
        stub(() => sparkBody([['GC=F', meta()]]));
        expect((await yahoo.quotes('x')).stale).toBe(false);
        axios.get.mockRejectedValue(rej429());
        require('../services/marketData/cache')._cache.clear(); // expire the 60 s promise cache, keep lastGood
        const r = await yahoo.quotes('x');
        expect(r.stale).toBe(true);
        expect(r.rows[0]).toEqual(expect.objectContaining({ symbol: 'GOLD', stale: true }));
        yahoo._test.reset();
        await expect(yahoo.quotes('x')).rejects.toBeTruthy();
    });
});

describe('yahoo quotes: closed-market cache and partial answers', () => {
    test('G3: the 15 min closed-market shortcut does not outlive the open (marketOpen recomputed from the trading period)', async () => {
        const T0 = 1.8e12;
        const spy = jest.spyOn(Date, 'now').mockReturnValue(T0);
        const m = meta({ regularMarketTime: T0 / 1000, currentTradingPeriod: { regular: { start: T0 / 1000 + 300, end: T0 / 1000 + 20000 } } });
        jest.spyOn(instruments, 'list').mockReturnValue([instruments.find('GOLD')]);
        stub(() => sparkBody([['GC=F', m]]));
        expect((await yahoo.quotes('c')).rows[0].marketOpen).toBe(false);
        spy.mockReturnValue(T0 + 200e3);
        expect((await yahoo.quotes('c')).rows[0].marketOpen).toBe(false); // still before the open: served from cache
        expect(calls).toHaveLength(1);
        spy.mockReturnValue(T0 + 400e3); // 100 s past the open, 400 s < 15 min
        expect((await yahoo.quotes('c')).rows[0].marketOpen).toBe(true);
        expect(calls).toHaveLength(2);
    });

    test('G4: a partial spark answer (chunk 2 hits 429) fills the missing symbols from the last good list with stale:true', async () => {
        const insts = instruments.INSTRUMENTS.slice(0, 22);
        jest.spyOn(instruments, 'list').mockReturnValue(insts);
        const asked = (url) => decodeURIComponent(url.split('symbols=')[1].split('&')[0]).split(',');
        let failSecond = false;
        jest.spyOn(axios, 'get').mockImplementation(async (url) => {
            if (failSecond && asked(url).includes(insts[21].yahoo)) throw rej429();
            return { data: sparkBody(asked(url).map((s) => [s, meta()])) };
        });
        expect((await yahoo.quotes('p')).rows).toHaveLength(22);
        failSecond = true;
        require('../services/marketData/cache')._cache.clear(); // expire the 60 s promise cache, keep lastGood
        const r = await yahoo.quotes('p');
        expect(r.rows.map((x) => x.symbol)).toEqual(insts.map((i) => i.symbol));
        expect(r.rows.filter((x) => x.stale).map((x) => x.symbol)).toEqual(insts.slice(20).map((i) => i.symbol));
    });
});

describe('yahoo klines', () => {
    const chart = (ts, q) => ({ chart: { result: [{ meta: meta(), timestamp: ts, indicators: { quote: [q] } }] } });

    test('null rows are filtered, ^ is encoded, interval map applied, stale last candle allowed', async () => {
        const old = nowS() - 30 * 86400;
        stub(() => chart([old, old + 86400, old + 2 * 86400], {
            open: [1, null, 3], high: [2, null, 4], low: [0.5, null, 2], close: [1.5, null, 3.5], volume: [10, null, null],
        }));
        const { candles } = await yahoo.klines(instruments.find('NIFTY50'), '1h', 10);
        expect(calls[0].url).toContain('/v8/finance/chart/%5ENSEI?range=3mo&interval=60m');
        expect(candles.map((c) => c.time)).toEqual([old, old + 2 * 86400]);
        expect(candles[1].volume).toBe(0);
    });

    test('commodity ticker = is encoded; unsupported 4h throws', async () => {
        stub(() => chart([nowS()], { open: [1], high: [2], low: [1], close: [2], volume: [1] }));
        await yahoo.klines(instruments.find('GOLD'), '1d');
        expect(calls[0].url).toContain('/v8/finance/chart/GC%3DF?range=2y&interval=1d');
        await expect(yahoo.klines(instruments.find('GOLD'), '4h')).rejects.toThrow();
    });
});

test('health has no URLs or upstream bodies', () => {
    const h = yahoo.health();
    expect(h.name).toBe('yahoo');
    expect(JSON.stringify(h)).not.toMatch(/http/i);
});
