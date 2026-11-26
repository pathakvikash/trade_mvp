jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
const { createCollector } = require('../services/orderflow/collector');
const { depthWithin, ladder } = require('../services/orderflow/bookStats');
const { newTracker, trackWalls, WALL_CAPS } = require('../services/orderflow/walls');

// book around `mid`: 20 levels a side, 0.1 apart, qty 10; `walls` = { 'bid:99.2': 500 } overrides a level's qty
const mk = (mid = 100, walls = {}, { bidQty = 10, askQty = 10 } = {}) => ({
    source: 'binance-futures', ts: 1,
    bids: Array.from({ length: 20 }, (_, i) => { const p = +(mid - 0.5 - i * 0.1).toFixed(4); return [p, walls[`bid:${p}`] ?? bidQty]; }),
    asks: Array.from({ length: 20 }, (_, i) => { const p = +(mid + 0.5 + i * 0.1).toFixed(4); return [p, walls[`ask:${p}`] ?? askQty]; }),
});
function setup(over = {}) {
    let t = 1e6;
    const f = { book: jest.fn(async () => mk()), trades: jest.fn(async () => ({ source: 'binance-futures', trades: [] })) };
    const c = createCollector({ fetchBook: f.book, fetchTrades: f.trades, now: () => t, idleMs: 1e12, wallConfirmMs: 5000, ...over });
    let started = false;
    const step = async (book, ms = 5000) => {
        if (book) f.book.mockResolvedValue(book);
        if (!started) { started = true; c.heatmap('BTCUSDT'); await new Promise((r) => setImmediate(r)); return c.heatmap('BTCUSDT'); } // first sample comes from touch()
        t += ms; await c.runAll(); return c.heatmap('BTCUSDT');
    };
    return { c, f, step, advance: (ms) => { t += ms; }, now: () => t };
}
afterEach(() => jest.useRealTimers());

describe('payload: ladder, depth, imbalance', () => {
    test('latest book: 20 levels a side nearest the spread, cumulative grows outward, spread and bands reported', async () => {
        const { c, step } = setup();
        const h = await step();
        expect(h.book.bids).toHaveLength(20);
        expect(h.book.asks).toHaveLength(20);
        expect(h.book.bestBid).toBeCloseTo(99.5);
        expect(h.book.bestAsk).toBeCloseTo(100.5);
        expect(h.book.spread).toBeCloseTo(1);
        expect(h.book.bids[0].price).toBeGreaterThan(h.book.bids[1].price); // best first
        expect(h.book.asks[0].price).toBeLessThan(h.book.asks[1].price);
        const cum = h.book.bids.map((l) => l.cumUsd);
        expect(cum).toEqual([...cum].sort((a, b) => a - b));
        expect(h.book.bids[1].cumUsd).toBe(h.book.bids[0].usd + h.book.bids[1].usd);
        expect(h.book.bids[1].cumQty).toBe(20);
        expect(h.bands).toEqual([0.5, 1, 2, 5]);
        expect(h.trades).toEqual([]);
    });

    test('depth within the band is honest when the snapshot does not reach it (partial, covered band reported)', () => {
        const mid = 100;
        const book = mk(mid); // covers 99.5..97.6 / 100.5..102.4: about 2.4% / 1.6% (the ask side limits it)
        const d1 = depthWithin(book.bids, book.asks, mid, 1);
        expect(d1.partial).toBe(false);
        expect(d1.bandPct).toBe(1);
        expect(d1.bidQty).toBeGreaterThanOrEqual(50); // 99.5 .. 99.1, plus 99.0 when the band edge counts
        expect(d1.bidQty).toBeLessThanOrEqual(60);
        const d5 = depthWithin(book.bids, book.asks, mid, 5);
        expect(d5.partial).toBe(true);
        expect(d5.bandPct).toBeLessThan(5);
        expect(d5.bandPct).toBeCloseTo(2.4, 1); // bids reach 97.6, asks 102.4: all the snapshot covers
        expect(d5.bidUsd).toBeGreaterThan(0);
    });

    test('imbalance: bids heavier is positive, asks heavier negative, and the 5 min ago value is the sample at least 5 min old', async () => {
        const { c, step } = setup();
        let h = await step(mk(100, {}, { bidQty: 30, askQty: 10 }));
        expect(h.imbalance.pct).toBeCloseTo(50, -1); // ~(30-10)/(30+10), USD-weighted
        expect(h.imbalance.prevPct).toBeNull(); // not enough history yet
        for (let i = 0; i < 70; i += 1) h = await step(mk(100, {}, { bidQty: 30, askQty: 10 }));
        h = await step(mk(100, {}, { bidQty: 10, askQty: 30 }));
        expect(h.imbalance.pct).toBeCloseTo(-50, -1);
        expect(h.imbalance.prevPct).toBeCloseTo(50, -1);
        expect(h.imbalance.prevAgoMs).toBeGreaterThanOrEqual(5 * 60e3);
        expect(h.depth.requestedPct).toBe(1);
        expect(c.heatmap('BTCUSDT', { band: '2' }).depth.requestedPct).toBe(2);
    });

    test('ladder groups by the price grid and the grid param widens the heat rows', async () => {
        const g = ladder(mk().bids, mk().asks, 1, 20);
        expect(g.bids.length).toBeLessThan(20);
        expect(g.bids[0].qty).toBeGreaterThan(10); // several 0.1 levels in one $1 bucket
        const { c, step } = setup();
        const h1 = await step();
        const h2 = c.heatmap('BTCUSDT', { grid: '2' });
        expect(h2.priceStep).toBe(h1.priceStep * 2);
        expect(h2.grid).toBe(2);
        const total = (h) => h.cells.reduce((a, b) => a + b, 0);
        expect(Math.abs(total(h2) - total(h1)) / total(h1)).toBeLessThan(0.02);
        expect(c.heatmap('BTCUSDT', { grid: 'abc' }).grid).toBe(1);
    });
});

describe('wall lifecycle', () => {
    const W = { 'bid:99.2': 500 };

    test('walls on the first snapshot get no appeared event; one that shows up later does; largest wall has distance and age', async () => {
        const { c, step } = setup();
        let h = await step(mk(100, W));
        expect(h.wallEvents).toEqual([]);
        expect(h.walls.largestBid).toMatchObject({ price: 99.2, upForMs: 0 });
        expect(h.walls.largestAsk).toBeNull();
        h = await step(mk(100, { ...W, 'ask:100.6': 800 }));
        expect(h.wallEvents).toEqual([]); // not stood for confirmMs yet
        h = await step(mk(100, { ...W, 'ask:100.6': 800 }));
        expect(h.wallEvents).toHaveLength(1);
        expect(h.wallEvents[0]).toMatchObject({ outcome: 'appeared', side: 'ask', price: 100.6 });
        h = await step(mk(100, { ...W, 'ask:100.6': 800 }), 60e3);
        expect(h.walls.largestAsk.price).toBe(100.6);
        expect(h.walls.largestAsk.distPct).toBeCloseTo(0.6, 1);
        expect(h.walls.largestAsk.upForMs).toBe(65e3);
        expect(h.walls.largestBid.upForMs).toBe(70e3);
        expect(h.walls.thresholdMult).toBe(10);
    });

    test('large() carries the active wall list and the event log (additive fields)', async () => {
        const { c, step } = setup();
        await step(mk(100, W));
        await step(mk(100, W), 30e3);
        let l = c.large('BTCUSDT');
        expect(l.activeWalls[0]).toMatchObject({ side: 'bid', price: 99.2 });
        expect(l.levels[0]).toMatchObject({ side: 'bid', price: 99.2, usd: 99.2 * 500 });
        expect(l.levels[0].mult).toBeGreaterThan(10);
        expect(l.wallEvents).toEqual([]);
        await step(mk(100));
        l = c.large('BTCUSDT');
        expect(l.activeWalls).toEqual([]);
        expect(l.wallEvents[0]).toMatchObject({ outcome: 'pulled', price: 99.2 });
    });

    test('pulled: the wall vanishes while price stays away from it', async () => {
        const { c, step } = setup();
        await step(mk(100, W));
        await step(mk(100, W), 30e3);
        const h = await step(mk(100)); // wall gone, mid unchanged
        expect(h.wallEvents[0]).toMatchObject({ outcome: 'pulled', side: 'bid', price: 99.2, usd: 99.2 * 500 });
        expect(h.wallEvents[0].lifetimeMs).toBe(35e3);
        expect(h.walls.largestBid).toBeNull();
    });

    test('filled: the wall vanishes after price traded down through it (mid series)', async () => {
        const { c, step } = setup();
        await step(mk(100, W));
        await step(mk(100, W));
        const h = await step(mk(98.5)); // price dropped below 99.2, the level is gone
        expect(h.wallEvents[0]).toMatchObject({ outcome: 'filled', price: 99.2 });
    });

    test('filled: a taker trade through the level counts even when the mid never touched it; a wrong-side trade does not', async () => {
        const a = setup();
        await a.step(mk(100, W));
        a.f.trades.mockResolvedValue({ source: 'binance-futures', trades: [{ id: 'x1', ts: a.now() + 100e3, price: 99.1, qty: 1, side: 'sell' }] });
        // trades ingest on tick 0 and every 3rd: run a few samples with the wall still up, then remove it
        await a.step(mk(100, W)); await a.step(mk(100, W)); await a.step(mk(100, W)); await a.step(mk(100, W));
        const h = await a.step(mk(100));
        expect(h.wallEvents[0].outcome).toBe('filled');

        const b = setup();
        await b.step(mk(100, W));
        b.f.trades.mockResolvedValue({ source: 'binance-futures', trades: [{ id: 'y1', ts: b.now() + 100e3, price: 99.1, qty: 1, side: 'buy' }] });
        await b.step(mk(100, W)); await b.step(mk(100, W)); await b.step(mk(100, W)); await b.step(mk(100, W));
        expect((await b.step(mk(100))).wallEvents[0].outcome).toBe('pulled');
    });

    test('a level that leaves the snapshot range (price moved away) is not called pulled; it is dropped quietly after a while', () => {
        const wt = newTracker();
        const base = { bestBid: 99.5, bestAsk: 100.5, cols: [{ t: 0, mid: 100 }], trades: [], wallMult: 10, confirmMs: 1000 };
        const book = (mid, walls) => mk(mid, walls);
        let b = book(100, W);
        trackWalls(wt, { ...base, bids: b.bids, asks: b.asks, t: 1000 });
        b = book(120); // snapshot now covers 118..122: 99.2 is out of range
        trackWalls(wt, { ...base, bids: b.bids, asks: b.asks, t: 2000 });
        expect(wt.events).toHaveLength(0);
        expect([...wt.walls.values()][0].status).toBe('active');
        trackWalls(wt, { ...base, bids: b.bids, asks: b.asks, t: 2000 + WALL_CAPS.outRangeMs + 1 });
        expect(wt.walls.size).toBe(0);
        expect(wt.events).toHaveLength(0);
    });

    test('caps: the event log keeps the newest 200 and the wall map stays bounded', () => {
        const wt = newTracker();
        const base = { bestBid: 99.5, bestAsk: 100.5, cols: [{ t: 0, mid: 100 }], trades: [], wallMult: 10, confirmMs: 1000 };
        let t = 1;
        for (let i = 0; i < 400; i += 1) { // the wall stands for two snapshots (announced), then is pulled
            const b = mk(100, i % 3 === 2 ? {} : { 'bid:99.2': 500 });
            t += 1000;
            trackWalls(wt, { ...base, bids: b.bids, asks: b.asks, t });
        }
        expect(wt.events.length).toBe(WALL_CAPS.maxEvents);
        expect(wt.events[wt.events.length - 1].t).toBeLessThanOrEqual(t);
        // a wall seen on one snapshot only is a flicker: no event at all
        const flick = newTracker();
        [{ 'bid:99.2': 500 }, {}, { 'bid:99.2': 500 }, {}].forEach((w, i) => { const b = mk(100, w); trackWalls(flick, { ...base, confirmMs: 5000, bids: b.bids, asks: b.asks, t: 1000 * (i + 1) }); });
        expect(flick.events).toEqual([]);
        expect(wt.walls.size).toBeLessThanOrEqual(WALL_CAPS.maxWalls);
        // many distinct walls over time: closed ones are pruned
        const many = newTracker();
        for (let i = 0; i < 300; i += 1) {
            const p = +(99.5 - (i % 19) * 0.1).toFixed(4);
            const b = mk(100, { [`bid:${p}`]: 500 });
            trackWalls(many, { ...base, bids: b.bids, asks: b.asks, t: i * 1000 + 1 });
        }
        expect(many.walls.size).toBeLessThanOrEqual(WALL_CAPS.maxWalls);
    });

    test('trade bubbles are capped at maxBubbles (biggest kept, in time order); source change clears walls and events', async () => {
        const { c, f, step, now } = setup({ maxBubbles: 5 });
        await step(mk(100, W));
        const t0 = now();
        f.trades.mockResolvedValue({ source: 'binance-futures', trades: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, ts: t0 + i, price: 100, qty: i + 1, side: i % 2 ? 'buy' : 'sell' })) });
        let h;
        for (let i = 0; i < 4; i += 1) h = await step(mk(100, W));
        expect(h.trades).toHaveLength(5);
        expect(h.trades.map((x) => x.usd)).toEqual(h.trades.map((x) => x.usd).sort((a, b) => a - b)); // time order == size order here
        expect(h.trades[4].usd).toBe(3000);
        expect(h.lastPrice).toBe(100);
        await step(mk(100));
        const sw = await step({ ...mk(100), source: 'bybit' });
        expect(sw.wallEvents).toEqual([]);
    });
});
