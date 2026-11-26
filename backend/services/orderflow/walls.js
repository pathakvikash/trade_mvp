// Wall lifecycle across depth snapshots. A wall = a level >= wallMult x the median level of its snapshot (the same 10x rule as
// the Large Orders view). It lives in a bounded map keyed side:price with firstSeen / lastSeen / peak and a status:
//   active -> filled  price traded through or touched the level after we last saw it (best bid/ask, the mid series, the trade tape)
//   active -> pulled  gone (or shrunk below half the threshold) while price never reached it
// Walls present on the very first snapshot get no "appeared" event (we did not see them appear). A wall must stand for confirmMs
// (default 30 s) before it is announced or its end is logged: short flickers on a busy book (BTC) are noise, not walls.
// ponytail: a level only counts as gone while it is inside the range the snapshot covers; when price moves away and the level
// leaves the snapshot it is dropped silently after outRangeMs, never labelled pulled. Candidates are the top maxPerSnap levels.
const { median } = require('./bookStats');

const WALL_CAPS = { maxWalls: 100, maxEvents: 200, maxPerSnap: 40, outRangeMs: 5 * 60e3, confirmMs: 30e3 };
const keyOf = (side, price) => `${side}:${price}`;

const newTracker = () => ({ walls: new Map(), events: [], primed: false });

function touched(w, { bestBid, bestAsk, cols, trades }) {
    const bid = w.side === 'bid';
    const hit = (p) => (bid ? p <= w.price : p >= w.price);
    if (hit(bid ? bestBid : bestAsk)) return true;
    for (let i = cols.length - 1; i >= 0 && cols[i].t >= w.lastSeen; i -= 1) if (hit(cols[i].mid)) return true;
    return trades.some((x) => x.ts >= w.lastSeen && x.side === (bid ? 'sell' : 'buy') && hit(x.price));
}

// snap: { bids, asks, t, bestBid, bestAsk, cols, trades, wallMult }
function trackWalls(wt, snap) {
    const { bids, asks, t, wallMult, confirmMs = WALL_CAPS.confirmMs } = snap;
    const lv = [...bids.map(([p, q]) => ({ side: 'bid', price: p, qty: q })), ...asks.map(([p, q]) => ({ side: 'ask', price: p, qty: q }))].map((l) => ({ ...l, usd: l.price * l.qty }));
    const med = median(lv.map((l) => l.usd));
    if (!(med > 0)) return;
    const thr = wallMult * med;
    const at = new Map(lv.map((l) => [keyOf(l.side, l.price), l]));
    const minBid = Math.min(...bids.map((l) => l[0]));
    const maxAsk = Math.max(...asks.map((l) => l[0]));
    const event = (w, outcome, at = t) => {
        wt.events.push({ t: at, side: w.side, price: w.price, usd: w.peak, lifetimeMs: at === t ? t - w.firstSeen : 0, outcome });
        if (wt.events.length > WALL_CAPS.maxEvents) wt.events.splice(0, wt.events.length - WALL_CAPS.maxEvents);
    };
    for (const [k, w] of wt.walls) {
        if (w.status !== 'active') continue;
        const l = at.get(k);
        if (l && l.usd >= thr / 2) {
            w.lastSeen = t; w.usd = l.usd; w.qty = l.qty; w.peak = Math.max(w.peak, l.usd);
            if (!w.confirmed && t - w.firstSeen >= confirmMs) { w.confirmed = true; if (!w.quiet) event(w, 'appeared', w.firstSeen); }
            continue;
        }
        if (!l && (w.price < minBid || w.price > maxAsk)) { if (t - w.lastSeen > WALL_CAPS.outRangeMs) wt.walls.delete(k); continue; }
        if (!w.confirmed) { wt.walls.delete(k); continue; } // a flicker
        w.status = touched(w, snap) ? 'filled' : 'pulled';
        w.closedAt = t;
        event(w, w.status);
    }
    lv.filter((l) => l.usd >= thr).sort((a, b) => b.usd - a.usd).slice(0, WALL_CAPS.maxPerSnap).forEach((l) => {
        const k = keyOf(l.side, l.price);
        if (wt.walls.get(k)?.status === 'active') return;
        const w = { side: l.side, price: l.price, usd: l.usd, qty: l.qty, peak: l.usd, firstSeen: t, lastSeen: t, status: 'active', confirmed: false, quiet: !wt.primed };
        wt.walls.set(k, w);
    });
    wt.primed = true;
    if (wt.walls.size > WALL_CAPS.maxWalls) { // closed ones go first (oldest), then the smallest active
        const order = [...wt.walls.entries()].sort(([, a], [, b]) => (a.status === 'active') - (b.status === 'active') || (a.status === 'active' ? a.usd - b.usd : a.closedAt - b.closedAt));
        order.slice(0, wt.walls.size - WALL_CAPS.maxWalls).forEach(([k]) => wt.walls.delete(k));
    }
}

// Active walls (biggest first), the largest per side with distance from mid and how long it has been up, and the event log newest first.
function wallView(wt, mid, t) {
    const out = (w) => ({ side: w.side, price: w.price, usd: Math.round(w.usd), qty: w.qty, peakUsd: Math.round(w.peak), firstSeen: w.firstSeen, upForMs: t - w.firstSeen, distPct: ((w.price - mid) / mid) * 100 });
    const active = [...wt.walls.values()].filter((w) => w.status === 'active').sort((a, b) => b.usd - a.usd).map(out);
    return {
        active: active.slice(0, 30),
        largestBid: active.find((w) => w.side === 'bid') || null,
        largestAsk: active.find((w) => w.side === 'ask') || null,
        events: [...wt.events].reverse().map((e) => ({ ...e, usd: Math.round(e.usd) })),
    };
}

module.exports = { newTracker, trackWalls, wallView, WALL_CAPS };
