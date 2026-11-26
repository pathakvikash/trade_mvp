// In-process order-flow collector: the order book heatmap and "large orders" views have no historical feed behind them, so we
// sample the book ourselves. Nothing is backfilled: the matrix only holds what was seen since the collector started for that symbol.
//   - any USDT perp (the route checks the real futures list); a symbol is collected only while a client keeps asking for it (lazy start), and is
//     dropped (data too, so the history never has a hole) after idleMs without a request
//   - one depth snapshot per sampleMs per symbol (+ recent trades every tradesEvery samples), max maxActive symbols at once
//   - memory: per symbol at most maxCols columns (retainMs of samples), each a Float32Array over at most maxRows price buckets,
//     plus a global byte cap (maxBytes); the oldest columns go first. Trades: a ring of maxTrades.
//   - source tagging: a change of exchange (Binance blocked -> Bybit) clears the matrix instead of mixing two venues' sizes
// ponytail: REST snapshots, not the depth WebSocket: coverage is only the levels one snapshot returns (about +-0.05% on BTC,
// wider on alts), and fast order changes between snapshots are invisible. Upgrade path: the @depth stream, if Render allows it.
const logger = require('../../config/logger');
const providers = require('./providers');

const DEFAULTS = {
    sampleMs: 5000, tradesEvery: 3, retainMs: 2 * 3600e3, idleMs: 5 * 60e3, maxActive: 5, evictAfterMs: 30e3,
    maxCols: 1440, maxRows: 160, maxBytes: 4 * 1024 * 1024, maxTrades: 2000, staleMs: 60e3,
    minLevels: 5, maxSpreadPct: 2, // thin book: fewer levels per side than this, or a wider spread (%), is not worth a heatmap
    wallMult: 10, tradeMult: 10, minTradesForLarge: 50,
    outCols: 240, outRows: 120,
};
const COL_OVERHEAD = 64; // rough object cost on top of the typed array

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const niceStep = (x) => { const m = 10 ** Math.floor(Math.log10(x)); return [1, 2, 5, 10].map((k) => k * m).find((v) => v >= x); };

function createCollector({ fetchBook = providers.fetchBook, fetchTrades = providers.fetchTrades, now = Date.now, ...over } = {}) {
    const cfg = { ...DEFAULTS, ...over };
    const states = new Map(); // symbol -> state
    let timer = null;

    const bytesOf = (c) => c.v.byteLength + COL_OVERHEAD;
    const totalBytes = () => { let n = 0; for (const s of states.values()) n += s.bytes; return n; };
    const dropCol = (s) => { const c = s.cols.shift(); if (c) s.bytes -= bytesOf(c); };

    function reset(s) { s.cols = []; s.bytes = 0; s.trades = []; s.seen = new Set(); s.step = 0; s.startedAt = null; s.lastBook = null; }

    function enforce(s) {
        const t = now();
        while (s.cols.length && (t - s.cols[0].t > cfg.retainMs || s.cols.length > cfg.maxCols)) dropCol(s);
        while (totalBytes() > cfg.maxBytes) { // global cap: shave the symbol holding the most
            const big = [...states.values()].reduce((a, b) => (b.cols.length > a.cols.length ? b : a));
            if (!big.cols.length) break;
            dropCol(big);
        }
        s.startedAt = s.cols.length ? s.cols[0].t : null;
    }

    function ingestBook(s, book) {
        const bids = book.bids; const asks = book.asks;
        if (!bids.length || !asks.length) { // one side missing: an illiquid coin, not an error
            s.source = book.source;
            s.lastBook = { at: now(), ts: book.ts, mid: 0, bids, asks, thin: true };
            return;
        }
        const bestBid = Math.max(...bids.map((l) => l[0]));
        const bestAsk = Math.min(...asks.map((l) => l[0]));
        if (!(bestBid < bestAsk)) throw new Error('crossed book'); // a bad snapshot is skipped, never drawn
        if (s.source && s.source !== book.source) reset(s);
        s.source = book.source;
        const mid = (bestBid + bestAsk) / 2;
        if (bids.length < cfg.minLevels || asks.length < cfg.minLevels || ((bestAsk - bestBid) / mid) * 100 > cfg.maxSpreadPct) {
            s.lastBook = { at: now(), ts: book.ts, mid, bids, asks, thin: true }; // no column, no step: a thin book would fix a useless bucket width
            return;
        }
        if (!s.step) { // bucket width follows the book's own depth span, so it scales with price; fixed until the symbol is dropped
            const span = Math.max(...asks.map((l) => l[0])) - Math.min(...bids.map((l) => l[0]));
            s.step = niceStep(Math.max(span / (cfg.maxRows / 2), mid * 1e-6));
        }
        const half = cfg.maxRows / 2;
        const midIdx = Math.floor(mid / s.step);
        const lv = [...bids, ...asks].map(([p, q]) => [Math.floor(p / s.step), p * q]).filter(([i]) => Math.abs(i - midIdx) <= half);
        const t = now();
        s.lastBook = { at: t, ts: book.ts, mid, bids, asks };
        if (!lv.length) return;
        const i0 = Math.min(...lv.map((l) => l[0]));
        const v = new Float32Array(Math.max(...lv.map((l) => l[0])) - i0 + 1);
        lv.forEach(([i, usd]) => { v[i - i0] += usd; });
        const col = { t, mid, i0, v };
        s.cols.push(col);
        s.bytes += bytesOf(col);
        if (!s.startedAt) s.startedAt = t;
        enforce(s);
    }

    function ingestTrades(s, res) {
        if (s.source && res.source !== s.source) return; // do not mix venues
        const t = now();
        for (const x of res.trades) {
            const usd = x.price * x.qty;
            if (!x.id || s.seen.has(x.id) || !(usd > 0) || !Number.isFinite(x.ts) || t - x.ts > cfg.retainMs) continue;
            s.trades.push({ ...x, usd });
            s.seen.add(x.id);
        }
        s.trades.sort((a, b) => a.ts - b.ts);
        if (s.trades.length > cfg.maxTrades) s.trades = s.trades.slice(-cfg.maxTrades);
        s.seen = new Set(s.trades.map((x) => x.id));
    }

    async function tick(s) {
        if (s.busy) return; // a slow exchange must not stack requests
        s.busy = true;
        try {
            ingestBook(s, await fetchBook(s.symbol));
            s.lastOkAt = now();
            s.err = null;
            if (s.tickN++ % cfg.tradesEvery === 0) {
                try { ingestTrades(s, await fetchTrades(s.symbol)); } catch (e) { /* the book is the main feed; trades retry next round */ }
            }
        } catch (e) {
            s.err = e.blocked ? 'blocked' : 'fetch_failed';
            logger.debug(`orderflow ${s.symbol}: ${s.err}`); // never log provider error text
        } finally { s.busy = false; }
    }

    function stop(symbol) {
        states.delete(symbol);
        if (!states.size && timer) { clearInterval(timer); timer = null; }
    }

    // One pass: drop idle symbols, sample the rest. Exposed for tests; the interval calls it.
    async function runAll() {
        for (const s of [...states.values()]) if (now() - s.lastReq > cfg.idleMs) stop(s.symbol);
        await Promise.all([...states.values()].map(tick));
        for (const s of states.values()) enforce(s); // age trim must not depend on a successful fetch (outage: old columns still expire)
    }

    // A client asks for `symbol` (already validated by the route): starts collecting if needed. Returns the state, or { error: 'busy' } when full and nothing is quiet enough to evict.
    function touch(symbol) {
        let s = states.get(symbol);
        if (!s) {
            if (states.size >= cfg.maxActive) {
                // one client must not lock the others out: free the least recently requested symbol, if it has been quiet for a while
                const t = now();
                const lru = [...states.values()].filter((x) => t - x.lastReq > cfg.evictAfterMs).sort((a, b) => a.lastReq - b.lastReq)[0];
                if (!lru) return { error: 'busy' };
                stop(lru.symbol);
            }
            s = { symbol, lastReq: now(), tickN: 0, busy: false, err: null, lastOkAt: null, source: null };
            reset(s);
            states.set(symbol, s);
            if (!timer) { timer = setInterval(runAll, cfg.sampleMs); if (timer.unref) timer.unref(); }
            tick(s); // first sample now, not after sampleMs
        }
        s.lastReq = now();
        return { state: s };
    }

    const head = (s) => {
        const t = now();
        const collectedMs = s.startedAt ? t - s.startedAt : 0;
        const status = !s.lastBook ? (s.err ? 'unavailable' : 'collecting') : t - s.lastOkAt > cfg.staleMs ? 'stale' : s.lastBook.thin ? 'thin' : 'ok';
        return { symbol: s.symbol, status, source: s.source, startedAt: s.startedAt, collectedMs, samples: s.cols.length, sampleMs: cfg.sampleMs, retainMs: cfg.retainMs, generatedAt: t, ...(status === 'stale' && { stale: true }) };
    };

    // Dense, downsampled grid in the shape of liqheat (col-major cells, row 0 = lowest price) so the client can reuse heat.js.
    function heatmap(symbol) {
        const r = touch(symbol);
        if (r.error) return r;
        const s = r.state;
        enforce(s);
        const h = head(s);
        if (!s.cols.length || h.status === 'thin') return h;
        const t0 = s.cols[0].t;
        const span = s.cols[s.cols.length - 1].t - t0;
        const colMs = Math.max(cfg.sampleMs, Math.ceil(span / cfg.outCols / cfg.sampleMs) * cfg.sampleMs);
        const n = Math.floor(span / colMs) + 1;
        const rows = cfg.outRows;
        const price = s.lastBook.mid;
        const lo = Math.floor(price / s.step) - rows / 2;
        const sum = new Float64Array(n * rows);
        const cnt = new Uint16Array(n);
        const midSum = new Float64Array(n);
        for (const c of s.cols) {
            const g = Math.floor((c.t - t0) / colMs);
            cnt[g] += 1;
            midSum[g] += c.mid;
            for (let k = 0; k < c.v.length; k += 1) {
                const row = c.i0 + k - lo;
                if (row >= 0 && row < rows) sum[g * rows + row] += c.v[k];
            }
        }
        const cells = new Array(n * rows);
        const nz = [];
        const gaps = [];
        for (let g = 0; g < n; g += 1) {
            if (!cnt[g]) gaps.push(g);
            for (let k = 0; k < rows; k += 1) {
                const v = cnt[g] ? Math.round(sum[g * rows + k] / cnt[g]) : 0;
                cells[g * rows + k] = v;
                if (v > 0) nz.push(v);
            }
        }
        nz.sort((a, b) => a - b);
        const max = nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * 0.99))] : 0; // p99: one huge wall must not wash out the rest
        const mids = Array.from({ length: n }, (_, g) => (cnt[g] ? midSum[g] / cnt[g] : null));
        return { ...h, cols: n, rows, t0, colMs, priceMin: lo * s.step, priceStep: s.step, price, max, cells, mids, gaps };
    }

    // Walls (book levels >= wallMult x the median level) + large trades (>= tradeMult x the median recent trade). Description only.
    function large(symbol) {
        const r = touch(symbol);
        if (r.error) return r;
        const s = r.state;
        const h = head(s);
        if (!s.lastBook || s.lastBook.thin) return { ...h, items: [] };
        const { bids, asks, mid, at } = s.lastBook;
        const lv = [...bids.map(([p, q]) => ({ side: 'bid', price: p, qty: q })), ...asks.map(([p, q]) => ({ side: 'ask', price: p, qty: q }))].map((l) => ({ ...l, usd: l.price * l.qty }));
        const medLevel = median(lv.map((l) => l.usd));
        const walls = lv.filter((l) => medLevel > 0 && l.usd >= cfg.wallMult * medLevel).sort((a, b) => b.usd - a.usd).slice(0, 15)
            .map((l) => ({ kind: 'wall', ...l, mult: l.usd / medLevel, ts: at, distPct: ((l.price - mid) / mid) * 100 }));
        const enough = s.trades.length >= cfg.minTradesForLarge;
        const medTrade = enough ? median(s.trades.map((x) => x.usd)) : 0;
        const trades = enough ? s.trades.filter((x) => x.usd >= cfg.tradeMult * medTrade).slice(-30)
            .map((x) => ({ kind: 'trade', side: x.side, price: x.price, qty: x.qty, usd: x.usd, mult: x.usd / medTrade, ts: x.ts })) : [];
        return {
            ...h, price: mid, tradesSeen: s.trades.length,
            thresholds: { wallMult: cfg.wallMult, tradeMult: cfg.tradeMult, medianLevelUsd: medLevel, medianTradeUsd: medTrade, tradesNeeded: cfg.minTradesForLarge },
            items: [...walls, ...trades.reverse()].sort((a, b) => b.usd - a.usd),
        };
    }

    const stats = () => ({ active: [...states.keys()], bytes: totalBytes(), cols: [...states.values()].reduce((n, s) => n + s.cols.length, 0), running: !!timer });
    const reset_ = () => { [...states.keys()].forEach(stop); };
    return { touch, heatmap, large, runAll, stats, cfg, _test: { states, reset: reset_ } };
}

module.exports = Object.assign(createCollector(), { createCollector, DEFAULTS });
