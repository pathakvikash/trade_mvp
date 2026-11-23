// Market-data gateway controller. ANALYTICS ONLY: nothing here may ever feed a fill, mark, liquidation, TP/SL or alert
// (futuresRest.markPrice does not touch this module). Third-party rows are cleaned (validate.js), tagged with their provider
// name (non-enumerable `source`, like futuresRest's tag) and an empty/stale/erroring provider just hands over to the next one.
//
// Chains: klines binance>bybit>bitget>gate>mexc>spot>[]('unavailable'); oiHist binance>bybit>gate; ratio binance>bybit>gate>bitget;
// topRatio binance>gate; taker binance>gate; funding binance>bybit>bitget>gate>mexc.
//   first(cap, sym, ...args)       whole chain. A Binance error that is not fallbackable (400/-1121) is rethrown as today.
//   rest(cap, sym, ...args)        same chain without Binance (the caller already tried it).
//   after(binErr, cap, sym, ...)   rest() that rethrows binErr when nothing answered at all (klines: spot failing too).
//   pair(sym, iv, nCandles, nOi)   {candles, oiHist, source} | null, both from the SAME provider and both non-empty. Walks
//                                  bybit>gate: futuresRest does Binance itself (verbatim) and calls this only after it failed.
// A provider is skipped when it lacks the capability, the registry says it does not list the symbol (zero requests), or its
// breaker is open (the breaker answers blocked without a request, and lets exactly one probe through when due).
const logger = require('../../config/logger');
const createBreaker = require('./breaker');
const createRegistry = require('./registry');
const validate = require('./validate');
const binance = require('./providers/binance');
const bybit = require('./providers/bybit');
const bitget = require('./providers/bitget');
const gate = require('./providers/gate');
const mexc = require('./providers/mexc');

const { fallbackable, statusOf } = createBreaker;
const IV_MS = { '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3, '6h': 21600e3, '12h': 43200e3, '1d': 86400e3, '1w': 604800e3 };
const DEADLINE_MS = 15e3; // overall budget of one klines/stats/pair chain: slow providers must not stack 4 s timeouts into a minute
const MULT_CAPS = new Set(['klines', 'oiHist', 'taker']); // size-bearing calls: Gate/MEXC contracts -> base coin

// `source` rides along invisibly (routes read it for X-Data-Source; JSON drops array props).
const tag = (arr, source) => Object.defineProperty(arr, 'source', { value: source, enumerable: false });

function clean(cap, rows, args) {
    if (cap === 'klines') return validate.candles(rows, IV_MS[args[0]] || 3600e3, Date.now());
    if (cap === 'oiHist') return validate.series(rows, 'oiUsd');
    if (cap === 'funding') return validate.series(rows, 'rate');
    return validate.series(rows, 'ratio'); // ratio, topRatio, taker
}

function create(providers, chains) {
    const breakers = {};
    for (const p of providers) breakers[p.name] = p.breaker || createBreaker(p.name, { tripOnNetwork: true, level: 'info' });
    // binance/bybit run their own requests through their breaker; every other provider is wrapped here
    const call = (p, fn) => (p.breaker ? fn() : breakers[p.name].run(fn));
    const reg = createRegistry(call);
    let spotWarned = false;

    async function callCap(p, cap, sym, args) {
        const extra = [];
        if (p.needsMult && MULT_CAPS.has(cap)) { const m = await reg.meta(p, sym); extra.push(m && m.mult); } // mult is always the LAST argument
        return call(p, () => p[cap](sym, ...args, ...extra));
    }

    async function spot(sym, args) {
        const rows = await binance.spotKlines(sym, ...args);
        spotWarned = false;
        return rows;
    }

    async function run(cap, sym, args, { skipBinance = false, err = null } = {}) {
        let binErr = err; // Binance's own error: what to rethrow when nothing answers
        let lastErr = null;
        let answered = false;
        const deadline = Date.now() + DEADLINE_MS;
        for (const p of chains[cap] || []) {
            const isB = p.name === 'binance';
            if (!p.has.has(cap) || (isB && skipBinance)) continue;
            if (Date.now() > deadline) {
                logger.warn(`marketData: ${cap} ${sym} over the ${DEADLINE_MS / 1000}s budget, skipping the remaining providers`);
                lastErr = lastErr || new Error('marketData deadline');
                break;
            }
            if ((await reg.lists(p, sym)) === false) continue; // not listed there: no request at all
            try {
                const rows = isB ? await callCap(p, cap, sym, args) : clean(cap, await callCap(p, cap, sym, args), args);
                answered = true;
                if (rows.length) return tag(rows, p.name);
            } catch (e) {
                if (isB && !fallbackable(e)) throw e; // a Binance 400 passes through as today
                if (isB) binErr = e;
                lastErr = e;
            }
        }
        if (cap === 'klines') {
            try {
                return tag(await spot(sym, args), 'spot');
            } catch (e2) {
                // spot 400 (-1121) = perp-only symbol: empty chart, NOT a 404 (the SPA would mark the market missing)
                if (statusOf(e2) === 400) return tag([], 'unavailable');
                if (!spotWarned) { spotWarned = true; logger.warn(`futuresRest: spot fallback failed (${e2.message})`); } // re-armed by the next success
                throw binErr || lastErr || e2;
            }
        }
        if (!answered && (binErr || lastErr)) throw binErr || lastErr;
        return tag([], 'unavailable');
    }

    async function pair(sym, iv, nCandles, nOi) {
        const deadline = Date.now() + DEADLINE_MS;
        for (const p of chains.pair || []) {
            if (Date.now() > deadline) { logger.warn(`marketData: pair ${sym} over the ${DEADLINE_MS / 1000}s budget, skipping the remaining providers`); break; }
            const generic = p.has.has('klines') && p.has.has('oiHist');
            if (!p.pair && !generic) continue;
            if ((await reg.lists(p, sym)) === false) continue;
            try {
                let candles;
                let oi;
                if (p.pair) {
                    const r = await call(p, () => p.pair(sym, iv, nCandles, nOi));
                    if (!r) continue;
                    ({ candles, oiHist: oi } = r);
                } else {
                    [candles, oi] = await Promise.all([callCap(p, 'klines', sym, [iv, nCandles]), callCap(p, 'oiHist', sym, [iv, nOi])]);
                }
                candles = clean('klines', candles, [iv]);
                const oiHist = clean('oiHist', oi, [iv]).map(({ ts, oiUsd }) => ({ ts, oiUsd }));
                if (candles.length && oiHist.length) return { candles, oiHist, source: p.name };
            } catch (e) { /* next provider */ }
        }
        return null;
    }

    const first = (cap, sym, ...args) => run(cap, sym, args);
    const rest = (cap, sym, ...args) => run(cap, sym, args, { skipBinance: true });
    const after = (binErr, cap, sym, ...args) => run(cap, sym, args, { skipBinance: true, err: binErr });
    const has = (name, cap) => providers.some((p) => p.name === name && (!cap || p.has.has(cap)));
    // No base URLs, env values or error bodies: names, capabilities, breaker state and list size only.
    const health = () => providers.map((p) => ({
        name: p.name, assetClass: 'crypto', capabilities: [...p.has], breaker: breakers[p.name].state(), listed: reg.size(p), listAt: reg.at(p),
    }));
    const reset = () => { Object.values(breakers).forEach((b) => b.reset()); reg.reset(); spotWarned = false; };

    return { first, rest, after, pair, has, health, breakers, reset, registry: reg };
}

const CRYPTO = [binance, bybit, bitget, gate, mexc];
const CHAINS = {
    klines: [binance, bybit, bitget, gate, mexc],
    oiHist: [binance, bybit, gate],
    ratio: [binance, bybit, gate, bitget],
    topRatio: [binance, gate],
    taker: [binance, gate],
    funding: [binance, bybit, bitget, gate, mexc],
    pair: [bybit, gate],
};

module.exports = Object.assign(create(CRYPTO, CHAINS), { create });
