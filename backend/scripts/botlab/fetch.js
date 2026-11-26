// Bot capability study: page back Binance USDS-M klines (same source as services/futuresRest) into a local cache.
// Usage: node fetch.js <outDir>. The app's /api/market/futures/klines route caps at 1000 rows and has no endTime, so
// history beyond that comes straight from fapi.binance.com/fapi/v1/klines, paged backwards.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT', 'MANTRAUSDT'];
const SPAN_DAYS = { '15m': 365, '1h': 3 * 365, '4h': 6 * 365 };
const IV_MS = { '15m': 900e3, '1h': 3600e3, '4h': 14400e3 };

async function page(symbol, interval, endTime) {
    const u = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1500&endTime=${endTime}`;
    for (let a = 0; a < 4; a++) {
        // curl, not fetch: Node's fetch ignores the HTTPS proxy env the sandbox routes egress through
        try { return JSON.parse(execFileSync('curl', ['-sf', '-m', '20', u], { maxBuffer: 1 << 26 })); } catch { /* retry */ }
        await new Promise((s) => setTimeout(s, 1000 * (a + 1)));
    }
    throw new Error(`fetch failed ${symbol} ${interval}`);
}

async function main() {
    const out = process.argv[2];
    fs.mkdirSync(out, { recursive: true });
    const now = Date.now();
    for (const s of SYMBOLS) for (const iv of Object.keys(SPAN_DAYS)) {
        const start = now - SPAN_DAYS[iv] * 864e5;
        const rows = new Map();
        let end = now;
        while (end > start) {
            const p = await page(s, iv, end);
            if (!p.length) break;
            for (const k of p) rows.set(k[0], { time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
            if (p[0][0] - IV_MS[iv] >= end) break;
            end = p[0][0] - 1;
            if (p.length < 1500) break; // listing start reached
        }
        // drop the still-forming last candle
        const c = [...rows.values()].filter((x) => x.time * 1000 >= start && (x.time * 1000 + IV_MS[iv]) <= now).sort((a, b) => a.time - b.time);
        fs.writeFileSync(path.join(out, `${s}_${iv}.json`), JSON.stringify(c));
        console.log(s, iv, c.length, new Date(c[0].time * 1000).toISOString().slice(0, 10), new Date(c[c.length - 1].time * 1000).toISOString().slice(0, 10));
    }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
