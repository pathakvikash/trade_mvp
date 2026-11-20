// Pure helpers for futuresService (kept separate so they are unit-testable without sockets).

const SYMBOL_RE = /^[A-Z0-9]{2,20}USDT$/;
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];

const isValidSymbol = (s) => typeof s === 'string' && SYMBOL_RE.test(s);

// Binance forceOrder message -> normalized liquidation event. SELL force order = a long got liquidated.
function normalizeForceOrder(msg) {
    const o = msg && msg.o;
    if (!o || (o.S !== 'BUY' && o.S !== 'SELL')) return null;
    // ap = average fill price (what actually got liquidated at); p = order limit price
    const price = parseFloat(o.ap) > 0 ? parseFloat(o.ap) : parseFloat(o.p);
    const qty = parseFloat(o.z) > 0 ? parseFloat(o.z) : parseFloat(o.q);
    if (!isValidSymbol(o.s) || !(price > 0) || !(qty > 0)) return null;
    return {
        symbol: o.s,
        side: o.S === 'SELL' ? 'long' : 'short',
        price,
        qty,
        usd: price * qty,
        ts: o.T || msg.E || Date.now(),
    };
}

// Binance kline stream payload (data.k) -> {time(sec), open, high, low, close, volume}
const normalizeKline = (k) => ({
    time: Math.floor(k.t / 1000),
    open: parseFloat(k.o),
    high: parseFloat(k.h),
    low: parseFloat(k.l),
    close: parseFloat(k.c),
    volume: parseFloat(k.v),
});

// Binance REST kline row -> same shape
const normalizeRestKline = (r) => ({
    time: Math.floor(r[0] / 1000),
    open: parseFloat(r[1]),
    high: parseFloat(r[2]),
    low: parseFloat(r[3]),
    close: parseFloat(r[4]),
    volume: parseFloat(r[5]),
});

// Binance aggTrade payload -> tape row. m:true = buyer is the maker, so the TAKER sold.
function normalizeAggTrade(d) {
    const price = parseFloat(d && d.p);
    const qty = parseFloat(d && d.q);
    if (!(price > 0) || !(qty > 0)) return null;
    return { price, qty, side: d.m ? 'sell' : 'buy', ts: d.T || d.E || Date.now() };
}

// Cross-symbol liquidation summary. bufs = iterable of event arrays (any order); now injectable for tests.
function summarizeLiquidations(bufs, now = Date.now()) {
    const H = 3600 * 1000;
    const windows = { '1h': H, '4h': 4 * H, '24h': 24 * H };
    const out = {};
    Object.keys(windows).forEach((k) => { out[k] = { longUsd: 0, shortUsd: 0, count: 0 }; });
    const bySym = new Map();
    const all = [];
    for (const buf of bufs) {
        for (const ev of buf) {
            const age = now - ev.ts;
            if (age > windows['24h']) continue;
            all.push(ev);
            const key = ev.side === 'long' ? 'longUsd' : 'shortUsd';
            Object.keys(windows).forEach((k) => {
                if (age <= windows[k]) { out[k][key] += ev.usd; out[k].count++; }
            });
            const s = bySym.get(ev.symbol) || { symbol: ev.symbol, longUsd: 0, shortUsd: 0, count: 0 };
            s[key] += ev.usd;
            s.count++;
            bySym.set(ev.symbol, s);
        }
    }
    const bySymbol = [...bySym.values()].sort((a, b) => b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd)).slice(0, 50);
    // ponytail: full sort of the 24h set; cached 2s upstream. Use a bounded heap if buffers grow large.
    const recent = all.sort((a, b) => b.ts - a.ts).slice(0, 60);
    return { windows: out, bySymbol, recent };
}

// ESTIMATED liquidation heatmap. Exchanges do NOT publish position liquidation prices, so this is a model:
// every hourly rise in open interest (USD) is treated as new positions opened during that candle, split 50/50
// long/short across a leverage mix, with entries spread over the candle's low (25%), typical price (50%) and
// high (25%). liq price = entry*(1 -/+ (1/lev - MMR)). A level is dropped once any LATER candle's low (longs) /
// high (shorts) crossed it (assumed already liquidated). Ignores partial closes and funding, so treat output as
// relative density, not exact positions.
const LEV_MIX = [5, 8, 10, 15, 20, 25, 33, 50, 75, 100, 125].map((lev, i) => ({ lev, w: [0.06, 0.08, 0.14, 0.10, 0.14, 0.14, 0.08, 0.12, 0.06, 0.06, 0.02][i] }));
const MMR = 0.004;

// Shared entry model. klines: [{time(sec), high, low, close}] ascending; oiHist: [{ts(ms), oiUsd}] ascending.
// Binance openInterestHist ts is the SNAPSHOT time T (verified: the newest row's ts is the current period's
// open, i.e. the close of the previous candle), so oi[T]-oi[T-1 period] was opened during the candle that opens
// at T-1 period. Returns one entry per (OI rise, entry price, leverage, side): {i: entry candle index, side, price: liq price, usd}.
function liqEntries(klines, oiHist, mix) {
    const idx = new Map(klines.map((k, i) => [k.time * 1000, i]));
    const out = [];
    for (let j = 1; j < oiHist.length; j++) {
        const delta = oiHist[j].oiUsd - oiHist[j - 1].oiUsd;
        const i = idx.get(oiHist[j - 1].ts); // candle that opened at the previous snapshot
        if (!(delta > 0) || i === undefined) continue;
        const k = klines[i];
        for (const [entry, ew] of [[k.low, 0.25], [(k.high + k.low + k.close) / 3, 0.5], [k.high, 0.25]]) {
            for (const { lev, w } of mix) {
                const usd = delta * 0.5 * w * ew;
                const d = 1 / lev - MMR;
                if (d <= 0) continue; // liq price would not be on the losing side of entry
                out.push({ i, side: 'long', price: entry * (1 - d), usd }, { i, side: 'short', price: entry * (1 + d), usd });
            }
        }
    }
    return out;
}

// Index of the first candle AFTER the entry candle that reaches the level (K.length if none). Longs are
// liquidated by a low at/below it, shorts by a high at/above it.
function firstCross(K, e) {
    let j = e.i + 1;
    while (j < K.length && !(e.side === 'long' ? K[j].low <= e.price : K[j].high >= e.price)) j++;
    return j;
}

function estimateLiqLevels({ klines, oiHist, price, buckets = 120, span = 0.15, tiers = LEV_MIX }) {
    const lo = price * (1 - span);
    const width = (2 * span * price) / buckets;
    const rows = Array.from({ length: buckets }, (_, i) => ({ price: lo + (i + 0.5) * width, longUsd: 0, shortUsd: 0 }));
    for (const e of liqEntries(klines, oiHist, tiers)) {
        if (firstCross(klines, e) < klines.length) continue;
        const b = Math.floor((e.price - lo) / width);
        if (b >= 0 && b < buckets) rows[b][e.side === 'long' ? 'longUsd' : 'shortUsd'] += e.usd;
    }
    return rows;
}

// Time x price grid of ESTIMATED open liquidation levels (same model as estimateLiqLevels). Columns = candles from
// `from` (ms; default the first candle) on; earlier candles only seed levels opened before the window. A level
// created by entries in candle e is open in columns e+1 .. (first later candle that crosses it) - 1, or to the last
// column. Each level adds difference-array entries on its price rows, so cost is O(levels + cells) plus the
// forward scan for its crossing candle (ponytail: linear scan, a sparse table would make it O(1) per level).
// The grid spans [window low*0.88, window high*1.12]. Each level is smoothed over its bucket and the two
// neighbours (0.25/0.5/0.25, clamped at the grid edges, total preserved). cells[c * rows + r] = USD open in
// column c at price bucket r (row 0 = priceMin). open = the last column's profile per price bucket
// (Float64Array per side). totals/outOfViewUsd cover ALL levels open at the last column, including those priced
// outside the grid (which have no cells). `candles` are the (filtered) window candles, one per column.
function estimateLiqHeat({ candles, oiHist, tiers = LEV_MIX, rows = 120, now = Date.now(), from }) {
    const K = (candles || []).filter((c) => c.time * 1000 <= now);
    const s = from == null ? 0 : Math.max(0, K.findIndex((c) => c.time * 1000 >= from));
    const n = K.length;
    const cols = n - s;
    const zero = () => new Float64Array(0);
    if (cols <= 0 || !(rows > 0)) return { cols: 0, rows: 0, colMs: 0, t0: 0, priceMin: 0, priceStep: 0, cells: zero(), max: 0, candles: [], open: { long: zero(), short: zero() }, totals: { longUsd: 0, shortUsd: 0 }, outOfViewUsd: 0 };
    const W = K.slice(s);
    const priceMin = Math.min(...W.map((c) => c.low)) * 0.88;
    const priceStep = (Math.max(...W.map((c) => c.high)) * 1.12 - priceMin) / rows;
    const diff = new Float64Array(rows * (cols + 1));
    const open = { long: new Float64Array(rows), short: new Float64Array(rows) };
    const totals = { longUsd: 0, shortUsd: 0 };
    let outOfViewUsd = 0;
    for (const e of liqEntries(K, oiHist || [], tiers)) {
        const j = firstCross(K, e);
        const a = Math.max(e.i + 1, s);
        if (a > j - 1) continue;
        const r = Math.floor((e.price - priceMin) / priceStep);
        const inView = r >= 0 && r < rows;
        if (j === n) {
            totals[e.side === 'long' ? 'longUsd' : 'shortUsd'] += e.usd;
            if (!inView) outOfViewUsd += e.usd;
        }
        if (!inView) continue;
        for (const [rr, f] of [[Math.max(0, r - 1), 0.25], [r, 0.5], [Math.min(rows - 1, r + 1), 0.25]]) {
            diff[rr * (cols + 1) + a - s] += e.usd * f;
            diff[rr * (cols + 1) + j - s] -= e.usd * f; // j - 1 + 1 (j - s may equal cols: spare slot)
            if (j === n) open[e.side][rr] += e.usd * f;
        }
    }
    const cells = new Float64Array(cols * rows);
    let max = 0;
    for (let r = 0; r < rows; r++) {
        let acc = 0;
        for (let c = 0; c < cols; c++) {
            acc += diff[r * (cols + 1) + c];
            const v = acc > 1e-9 ? acc : 0; // drop float residue
            cells[c * rows + r] = v;
            if (v > max) max = v;
        }
    }
    return { cols, rows, colMs: n > 1 ? (K[n - 1].time - K[n - 2].time) * 1000 : 0, t0: W[0].time * 1000, priceMin, priceStep, cells, max, candles: W, open, totals, outOfViewUsd };
}

// The `n` largest LOCAL PEAKS (bucket > 0 and >= both neighbours) of each side's last-column profile: shorts above
// price, longs below it. Nearest to price first. price is the bucket centre; pct is signed % from price.
function liqKeyLevels(open, priceMin, step, price, n = 7) {
    const side = (prof, keep) => {
        const out = [];
        prof.forEach((usd, b) => {
            const p = priceMin + (b + 0.5) * step;
            if (usd > 0 && keep(p) && usd >= (b > 0 ? prof[b - 1] : 0) && usd >= (b < prof.length - 1 ? prof[b + 1] : 0)) {
                out.push({ price: p, usd: Math.round(usd), pct: +(((p - price) / price) * 100).toFixed(2) });
            }
        });
        return out.sort((a, b) => b.usd - a.usd).slice(0, n).sort((a, b) => Math.abs(a.pct) - Math.abs(b.pct));
    };
    return { above: side(open.short, (p) => p > price), below: side(open.long, (p) => p < price) };
}

module.exports = { SYMBOL_RE, INTERVALS, isValidSymbol, normalizeForceOrder, normalizeKline, normalizeRestKline, normalizeAggTrade, summarizeLiquidations, estimateLiqLevels, estimateLiqHeat, liqKeyLevels, LEV_MIX, MMR };
