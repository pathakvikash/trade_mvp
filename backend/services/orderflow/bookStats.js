// Pure helpers over one depth snapshot (bids/asks = [[price, qty]]): the visible ladder and depth/imbalance within a band.
const BANDS = [0.5, 1, 2, 5]; // depth band choices, percent either side of mid
const GRIDS = [1, 2, 5, 10, 20]; // price grid = this multiple of the collector's base bucket

const snap = (x, allowed, fallback) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? allowed.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a)) : fallback; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
const round = (n, d = 6) => +n.toFixed(d);

// USD and base-coin size inside +-pct of mid. The snapshot may not reach that far (BTC: ~0.05%), so the band actually used is
// min(pct, the span both sides cover) and `partial` says so: the UI must show "within 0.04%", never a pretend 1%.
function depthWithin(bids, asks, mid, pct) {
    const spanB = ((mid - Math.min(...bids.map((l) => l[0]))) / mid) * 100;
    const spanA = ((Math.max(...asks.map((l) => l[0])) - mid) / mid) * 100;
    const covered = Math.min(spanB, spanA);
    const band = Math.max(0, Math.min(pct, covered));
    const sum = (rows, ok) => rows.filter(([p]) => ok(p)).reduce((a, [p, q]) => ({ usd: a.usd + p * q, qty: a.qty + q }), { usd: 0, qty: 0 });
    const b = sum(bids, (p) => p >= mid * (1 - band / 100));
    const a = sum(asks, (p) => p <= mid * (1 + band / 100));
    const tot = b.usd + a.usd;
    return { requestedPct: pct, bandPct: round(band, 3), partial: covered < pct, bidUsd: Math.round(b.usd), bidQty: b.qty, askUsd: Math.round(a.usd), askQty: a.qty, imbalance: tot > 0 ? ((b.usd - a.usd) / tot) * 100 : 0 };
}

// Top `n` levels per side nearest the spread, grouped into `width`-wide price buckets (bids rounded down, asks up), with running totals outward.
function ladder(bids, asks, width, n = 20) {
    const group = (rows, up) => {
        const m = new Map();
        rows.forEach(([p, q]) => {
            const i = up ? Math.ceil(p / width - 1e-9) : Math.floor(p / width + 1e-9);
            const g = m.get(i) || { price: round(i * width, 10), qty: 0, usd: 0 };
            g.qty += q; g.usd += p * q;
            m.set(i, g);
        });
        return [...m.values()].sort((x, y) => (up ? x.price - y.price : y.price - x.price)).slice(0, n);
    };
    const cum = (rows) => { let q = 0; let u = 0; return rows.map((r) => { q += r.qty; u += r.usd; return { ...r, usd: Math.round(r.usd), cumQty: q, cumUsd: Math.round(u) }; }); };
    return { bids: cum(group(bids, false)), asks: cum(group(asks, true)) };
}

module.exports = { BANDS, GRIDS, snap, median, depthWithin, ladder };
