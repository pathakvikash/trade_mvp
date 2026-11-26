jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('axios');
const axios = require('axios');
const { createCollector } = require('../services/orderflow/collector');
const providers = require('../services/orderflow/providers');

// fake exchange: a book around `mid` with `n` levels each side; level 3 on the bid side is a 50x wall
const book = (mid = 100, { source = 'binance-futures', wall = true, n = 20 } = {}) => ({
    source, ts: 1,
    bids: Array.from({ length: n }, (_, i) => [mid - 0.5 - i * 0.1, i === 3 && wall ? 500 : 10]),
    asks: Array.from({ length: n }, (_, i) => [mid + 0.5 + i * 0.1, 10]),
});
const tape = (n, big = true, source = 'binance-futures') => ({
    source, trades: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, ts: 1000 + i, price: 100, qty: big && i === n - 1 ? 100 : 1, side: i % 2 ? 'buy' : 'sell' })),
});

function setup(over = {}) {
    let t = 1e6;
    const f = { book: jest.fn(async () => book()), trades: jest.fn(async () => tape(60)) };
    const c = createCollector({ fetchBook: f.book, fetchTrades: f.trades, now: () => t, ...over });
    return { c, f, advance: (ms) => { t += ms; }, now: () => t };
}

afterEach(() => { jest.clearAllMocks(); jest.useRealTimers(); });

describe('collector', () => {
    test('any symbol starts lazily (MANTRAUSDT): collecting, then ok; bucket width scales with a 0.0025 price', async () => {
        const { c, f } = setup({ idleMs: 1e12 });
        f.book.mockImplementation(async () => ({
            source: 'binance-futures', ts: 1,
            bids: Array.from({ length: 20 }, (_, i) => [0.0025 - 0.000001 * (i + 1), 1e5]),
            asks: Array.from({ length: 20 }, (_, i) => [0.0025 + 0.000001 * (i + 1), 1e5]),
        }));
        expect(c.heatmap('MANTRAUSDT').status).toBe('collecting');
        await c.runAll();
        const h = c.heatmap('MANTRAUSDT');
        expect(h.status).toBe('ok');
        expect(h.priceStep).toBeLessThan(1e-5);
        expect(h.priceStep).toBeGreaterThan(0);
        expect(h.priceMin).toBeLessThan(0.0025);
        expect(h.priceMin + h.rows * h.priceStep).toBeGreaterThan(0.0025);
        expect(h.cells.every(Number.isFinite)).toBe(true);
        expect(Math.max(...h.cells)).toBeGreaterThan(0);
    });

    test('thin / empty books never crash or produce NaN: status thin, no grid, no walls', async () => {
        const { c, f } = setup({ idleMs: 1e12 });
        f.book.mockResolvedValue({ source: 'binance-futures', ts: 1, bids: [[0.0024, 1]], asks: [[0.0026, 1]] }); // 1 level a side
        c.heatmap('MANTRAUSDT');
        await c.runAll();
        let h = c.heatmap('MANTRAUSDT');
        expect(h.status).toBe('thin');
        expect(h.cols).toBeUndefined();
        expect(c.large('MANTRAUSDT')).toMatchObject({ status: 'thin', items: [] });
        f.book.mockResolvedValue({ source: 'binance-futures', ts: 1, bids: [], asks: [] });
        await c.runAll();
        expect(c.heatmap('MANTRAUSDT').status).toBe('thin');
        f.book.mockResolvedValue({ source: 'binance-futures', ts: 1, bids: Array.from({ length: 10 }, (_, i) => [50 - i, 1]), asks: Array.from({ length: 10 }, (_, i) => [100 + i, 1]) }); // 10 levels a side but 67% apart
        await c.runAll();
        expect(c.heatmap('MANTRAUSDT').status).toBe('thin');
        f.book.mockResolvedValue(book());
        await c.runAll();
        expect(c.heatmap('MANTRAUSDT').status).toBe('ok'); // recovers
    });

    test('lazy start: nothing runs until a client asks; first request answers "collecting", then data', async () => {
        const { c, f } = setup();
        expect(c.stats().running).toBe(false);
        const first = c.heatmap('BTCUSDT');
        expect(first.status).toBe('collecting');
        expect(first.cols).toBeUndefined();
        expect(c.stats().running).toBe(true);
        await c.runAll();
        const h = c.heatmap('BTCUSDT');
        expect(h.status).toBe('ok');
        expect(h.source).toBe('binance-futures');
        expect(h.cols).toBe(1);
        expect(h.cells).toHaveLength(h.cols * h.rows);
        expect(Math.max(...h.cells)).toBeGreaterThanOrEqual(50000); // 500 base x $100 wall (+ neighbours in the bucket)
        expect(h.priceMin).toBeLessThan(h.price);
        expect(h.priceMin + h.rows * h.priceStep).toBeGreaterThan(h.price);
        expect(f.book).toHaveBeenCalledWith('BTCUSDT');
    });

    test('idle stop: after idleMs without a request the symbol, its data and the timer are gone', async () => {
        const { c, advance } = setup({ idleMs: 60e3 });
        c.heatmap('BTCUSDT');
        await c.runAll();
        expect(c.stats().active).toEqual(['BTCUSDT']);
        advance(30e3);
        c.heatmap('BTCUSDT'); // a request keeps it alive
        advance(45e3);
        await c.runAll();
        expect(c.stats().active).toEqual(['BTCUSDT']);
        advance(61e3);
        await c.runAll();
        expect(c.stats()).toEqual({ active: [], bytes: 0, cols: 0, running: false });
        expect(c.heatmap('BTCUSDT').status).toBe('collecting'); // restarts empty: no stale history
    });

    test('the interval timer samples and stops by itself', async () => {
        jest.useFakeTimers();
        const { c, f } = setup({ sampleMs: 5000, idleMs: 12e3, now: Date.now });
        c.heatmap('BTCUSDT');
        await jest.advanceTimersByTimeAsync(10e3);
        expect(f.book.mock.calls.length).toBeGreaterThanOrEqual(3); // immediate + two intervals
        await jest.advanceTimersByTimeAsync(20e3);
        expect(c.stats().running).toBe(false);
    });

    test('max active symbols: the next one is refused as busy, not queued', () => {
        const { c } = setup({ maxActive: 2 });
        c.heatmap('BTCUSDT'); c.heatmap('ETHUSDT');
        expect(c.heatmap('SOLUSDT')).toEqual({ error: 'busy' });
        expect(c.heatmap('BTCUSDT').error).toBeUndefined(); // an active one still answers
    });

    test('starvation: a full collector evicts the least recently requested symbol once it is quiet >30 s, else stays busy', async () => {
        const { c, advance } = setup({ maxActive: 2, idleMs: 1e12 });
        c.heatmap('BTCUSDT');
        advance(10e3);
        c.heatmap('ETHUSDT');
        advance(10e3);
        expect(c.heatmap('SOLUSDT')).toEqual({ error: 'busy' }); // both requested < 30 s ago
        advance(25e3); // BTC 45 s quiet, ETH 35 s quiet
        const r = c.heatmap('SOLUSDT');
        expect(r.error).toBeUndefined();
        expect(c.stats().active.sort()).toEqual(['ETHUSDT', 'SOLUSDT']); // BTC (the oldest request) went
        c.heatmap('ETHUSDT'); // ETH is requested again: now both are fresh
        advance(1e3);
        expect(c.heatmap('XRPUSDT')).toEqual({ error: 'busy' });
    });

    test('retention: with every fetch failing, columns older than retainMs are still dropped (runAll and heatmap)', async () => {
        const { c, f, advance } = setup({ idleMs: 1e12, retainMs: 100e3 });
        c.heatmap('BTCUSDT');
        await c.runAll();
        expect(c.stats().cols).toBe(1);
        f.book.mockRejectedValue(new Error('down'));
        advance(101e3);
        await c.runAll();
        expect(c.stats().cols).toBe(0);
        const again = setup({ idleMs: 1e12, retainMs: 100e3 });
        again.c.heatmap('BTCUSDT');
        await again.c.runAll();
        again.f.book.mockRejectedValue(new Error('down'));
        again.advance(101e3);
        expect(again.c.heatmap('BTCUSDT').samples).toBe(0); // the read path trims too
    });

    test('memory cap: columns per symbol, age and the global byte cap are all enforced', async () => {
        const { c, advance } = setup({ idleMs: 1e12, maxCols: 50, retainMs: 1e9, maxBytes: 1e9 });
        c.heatmap('BTCUSDT');
        for (let i = 0; i < 200; i++) { advance(5000); await c.runAll(); }
        expect(c.stats().cols).toBe(50);

        const age = setup({ idleMs: 1e12, retainMs: 100e3, maxBytes: 1e9 });
        age.c.heatmap('BTCUSDT');
        for (let i = 0; i < 100; i++) { age.advance(5000); await age.c.runAll(); }
        expect(age.c.stats().cols).toBeLessThanOrEqual(21); // 100 s / 5 s (+ the boundary sample)
        expect(age.c.heatmap('BTCUSDT').t0).toBeGreaterThanOrEqual(age.now() - 100e3);

        const cap = setup({ idleMs: 1e12, maxBytes: 3000, maxCols: 1e6, retainMs: 1e9, maxActive: 3 });
        ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].forEach((s) => cap.c.heatmap(s));
        for (let i = 0; i < 100; i++) { cap.advance(5000); await cap.c.runAll(); }
        expect(cap.c.stats().bytes).toBeLessThanOrEqual(3000);
        expect(cap.c.stats().cols).toBeGreaterThan(3); // trimmed, not emptied
    });

    test('default budget: 3 symbols x 2 h of samples stays under the configured byte cap', async () => {
        const { c, advance } = setup({ idleMs: 1e12 });
        ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].forEach((s) => c.heatmap(s));
        for (let i = 0; i < 1600; i++) { advance(5000); await c.runAll(); } // > 2 h
        expect(c.stats().bytes).toBeLessThanOrEqual(c.cfg.maxBytes);
        expect(c.stats().cols).toBeLessThanOrEqual(3 * c.cfg.maxCols);
    });

    test('heatmap grid is downsampled to <= outCols and marks gaps', async () => {
        const { c, advance } = setup({ idleMs: 1e12, outCols: 10 });
        c.heatmap('BTCUSDT');
        for (let i = 0; i < 40; i++) { advance(5000); await c.runAll(); }
        const h = c.heatmap('BTCUSDT');
        expect(h.cols).toBeLessThanOrEqual(11);
        expect(h.colMs).toBeGreaterThan(5000);
        expect(h.mids).toHaveLength(h.cols);
        const gap = setup();
        gap.c.heatmap('BTCUSDT');
        await gap.c.runAll();
        gap.advance(60e3); // a minute with no samples
        await gap.c.runAll();
        expect(gap.c.heatmap('BTCUSDT').gaps.length).toBeGreaterThan(0);
    });

    test('a bad snapshot (crossed/empty) is skipped, failure is reported honestly, nothing is invented', async () => {
        const { c, f } = setup();
        f.book.mockResolvedValue({ source: 'binance-futures', ts: 1, bids: [[101, 1]], asks: [[100, 1]] });
        c.heatmap('BTCUSDT');
        await c.runAll();
        expect(c.heatmap('BTCUSDT').status).toBe('unavailable');
        f.book.mockRejectedValue(Object.assign(new Error('x'), { blocked: true }));
        await c.runAll();
        expect(c.heatmap('BTCUSDT').cols).toBeUndefined();
    });

    test('stale: data older than staleMs is flagged, still served', async () => {
        const { c, f, advance } = setup();
        c.heatmap('BTCUSDT');
        await c.runAll();
        f.book.mockRejectedValue(new Error('down'));
        advance(90e3);
        await c.runAll();
        const h = c.heatmap('BTCUSDT');
        expect(h.status).toBe('stale');
        expect(h.stale).toBe(true);
        expect(h.cols).toBe(1);
    });

    test('a change of exchange clears the matrix instead of mixing venues', async () => {
        const { c, f, advance } = setup();
        c.heatmap('BTCUSDT');
        await c.runAll();
        advance(5000); await c.runAll();
        expect(c.heatmap('BTCUSDT').cols).toBeGreaterThan(0);
        f.book.mockResolvedValue(book(100, { source: 'bybit' }));
        f.trades.mockResolvedValue(tape(60, true, 'bybit'));
        advance(5000); await c.runAll();
        const h = c.heatmap('BTCUSDT');
        expect(h.source).toBe('bybit');
        expect(h.samples).toBe(1);
    });
});

describe('large orders', () => {
    test('wall = level >= 10x the median level; large trade = >= 10x the median trade; each labelled', async () => {
        const { c } = setup();
        c.heatmap('BTCUSDT');
        await c.runAll();
        const l = c.large('BTCUSDT');
        const wall = l.items.filter((i) => i.kind === 'wall');
        const trade = l.items.filter((i) => i.kind === 'trade');
        expect(wall).toHaveLength(1);
        expect(wall[0]).toMatchObject({ side: 'bid', qty: 500 });
        expect(wall[0].mult).toBeGreaterThan(40);
        expect(wall[0].distPct).toBeLessThan(0);
        expect(trade).toHaveLength(1);
        expect(trade[0]).toMatchObject({ qty: 100, usd: 10000 });
        expect(l.thresholds).toMatchObject({ wallMult: 10, tradeMult: 10 });
        expect(l.items[0].usd).toBeGreaterThanOrEqual(l.items[1].usd);
    });

    test('too few trades: no trade rows (no median to compare with); walls still listed; duplicates are not re-added', async () => {
        const { c, f, advance } = setup({ tradesEvery: 1 });
        f.trades.mockResolvedValue(tape(10));
        c.heatmap('BTCUSDT');
        await c.runAll();
        expect(c.large('BTCUSDT').items.every((i) => i.kind === 'wall')).toBe(true);
        f.trades.mockResolvedValue(tape(60));
        advance(5000); await c.runAll();
        advance(5000); await c.runAll(); // same ids again
        expect(c.large('BTCUSDT').tradesSeen).toBe(60);
    });

    test('collecting state before the first snapshot', () => {
        const { c } = setup();
        expect(c.large('ETHUSDT')).toMatchObject({ status: 'collecting', items: [] });
    });
});

describe('providers', () => {
    test('Binance first; on a block (451) falls back to Bybit and tags it', async () => {
        axios.get.mockImplementation(async (url) => {
            if (url.includes('fapi')) throw Object.assign(new Error('blocked'), { response: { status: 451, headers: {} } });
            if (url.includes('orderbook')) return { data: { retCode: 0, result: { ts: 5, b: [['99', '2']], a: [['101', '3']] } } };
            return { data: { retCode: 0, result: { list: [{ execId: 'e1', price: '100', size: '2', side: 'Buy', time: '9' }] } } };
        });
        const b = await providers.fetchBook('BTCUSDT');
        expect(b).toEqual({ source: 'bybit', ts: 5, bids: [[99, 2]], asks: [[101, 3]] });
        expect(await providers.fetchTrades('BTCUSDT')).toEqual({ source: 'bybit', trades: [{ id: 'ye1', ts: 9, price: 100, qty: 2, side: 'buy' }] });
    });
});
