// Base rates for "+$10 on $20 margin in 15 min to 1 h" (5x -> $100 notional -> +10% price, +~10.1% after fees).
// From each candle open: does price TOUCH +X% (long) / -X% (short) within the window, and does -10% come first?
// Usage: node goal.js <klinesDir> <out.json>. Windows built from 15m candles (1 y) and 1h candles (3 y, 1 h window only).
const fs = require('fs');
const path = require('path');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT', 'MANTRAUSDT'];
const LEVELS = [0.5, 1, 2, 5, 10];

function rates(c, bars) {
    const n = c.length - bars + 1;
    const up = Object.fromEntries(LEVELS.map((x) => [x, 0])), either = { ...up };
    let tenFirst = 0, minusTenFirst = 0, sameBar = 0;
    for (let i = 0; i < n; i++) {
        const o = c[i].open;
        let hi = -Infinity, lo = Infinity, firstUp = -1, firstDn = -1;
        for (let j = i; j < i + bars; j++) {
            hi = Math.max(hi, c[j].high); lo = Math.min(lo, c[j].low);
            if (firstUp < 0 && c[j].high >= o * 1.10) firstUp = j;
            if (firstDn < 0 && c[j].low <= o * 0.90) firstDn = j;
        }
        for (const x of LEVELS) {
            if (hi >= o * (1 + x / 100)) up[x]++;
            if (hi >= o * (1 + x / 100) || lo <= o * (1 - x / 100)) either[x]++;
        }
        if (firstUp >= 0 && firstDn >= 0 && firstUp === firstDn) sameBar++;
        else if (firstUp >= 0 && (firstDn < 0 || firstUp < firstDn)) tenFirst++;
        else if (firstDn >= 0) minusTenFirst++;
    }
    const pct = (k) => +(k / n * 100).toFixed(4);
    return {
        windows: n,
        longTouchPct: Object.fromEntries(LEVELS.map((x) => [x, pct(up[x])])),
        eitherTouchPct: Object.fromEntries(LEVELS.map((x) => [x, pct(either[x])])),
        plus10FirstPct: pct(tenFirst), minus10FirstPct: pct(minusTenFirst), sameBarAmbiguousPct: pct(sameBar),
        plus10Count: tenFirst,
    };
}

const [dir, outFile] = process.argv.slice(2);
const out = {};
for (const s of SYMBOLS) {
    const m15 = JSON.parse(fs.readFileSync(path.join(dir, `${s}_15m.json`), 'utf8'));
    const h1 = JSON.parse(fs.readFileSync(path.join(dir, `${s}_1h.json`), 'utf8'));
    out[s] = { w15m: rates(m15, 1), w1h_from15m: rates(m15, 4), w1h_3y: rates(h1, 1) };
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([s, r]) => [s, { m15: [r.w15m.longTouchPct, r.w15m.plus10FirstPct], h1: [r.w1h_from15m.longTouchPct, r.w1h_from15m.eitherTouchPct, r.w1h_from15m.plus10FirstPct, r.w1h_from15m.minus10FirstPct], h1_3y: [r.w1h_3y.plus10FirstPct, r.w1h_3y.minus10FirstPct, r.w1h_3y.windows] }]))));
