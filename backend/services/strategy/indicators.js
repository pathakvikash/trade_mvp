// Pure indicator maths over number arrays. null during warm-up. Window sums are recomputed per bar
// (period <= 200, <= 1000 bars) so results depend only on data <= i.
const sma = (a, p) => a.map((_, i) => {
    if (i < p - 1) return null;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) { if (a[j] === null) return null; s += a[j]; }
    return s / p;
});

// EMA seeded with the SMA of the first p non-null values (skips leading nulls, e.g. MACD signal).
function ema(a, p) {
    const out = a.map(() => null);
    const s = a.findIndex((x) => x !== null);
    if (s < 0 || s + p > a.length) return out;
    let prev = 0;
    for (let j = s; j < s + p; j++) prev += a[j];
    prev /= p;
    out[s + p - 1] = prev;
    const k = 2 / (p + 1);
    for (let i = s + p; i < a.length; i++) { prev = a[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
}

function rsi(a, p) {
    const out = a.map(() => null);
    if (a.length <= p) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = a[i] - a[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= p; l /= p;
    const val = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
    out[p] = val();
    for (let i = p + 1; i < a.length; i++) {
        const d = a[i] - a[i - 1];
        g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
        l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
        out[i] = val();
    }
    return out;
}

// Wilder ATR: TR from bar 1; seed = mean of TR[1..p] placed at bar p.
function atr(candles, p) {
    const out = candles.map(() => null);
    if (candles.length <= p) return out;
    const tr = (i) => {
        const c = candles[i], pc = candles[i - 1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    };
    let a = 0;
    for (let i = 1; i <= p; i++) a += tr(i);
    a /= p;
    out[p] = a;
    for (let i = p + 1; i < candles.length; i++) { a = (a * (p - 1) + tr(i)) / p; out[i] = a; }
    return out;
}

function bollinger(a, p, k) {
    const middle = sma(a, p);
    const upper = [], lower = [];
    middle.forEach((m, i) => {
        if (m === null) { upper.push(null); lower.push(null); return; }
        let v = 0;
        for (let j = i - p + 1; j <= i; j++) v += (a[j] - m) ** 2;
        const sd = Math.sqrt(v / p); // population SD
        upper.push(m + k * sd); lower.push(m - k * sd);
    });
    return { upper, middle, lower };
}

function macd(a, fast, slow, signal) {
    const f = ema(a, fast), s = ema(a, slow);
    const line = a.map((_, i) => (f[i] === null || s[i] === null ? null : f[i] - s[i]));
    const sig = ema(line, signal);
    return { macd: line, signal: sig, hist: line.map((x, i) => (sig[i] === null ? null : x - sig[i])) };
}

module.exports = { sma, ema, rsi, atr, bollinger, macd };
