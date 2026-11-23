// Deterministic long/short simulator. Fixed notional (1 unit), no compounding, no leverage, one position.
// Fill rules (all pessimistic): signal on bar i fills at bar i+1 OPEN; stop/target checked on the fill bar
// onward with high/low; stop and target in the same bar => STOP; maxBars exits at that bar's close.
// A stop the price GAPS through (bar opens beyond it) fills at that open, not at the stop (long min(open, stop), short
// max(open, stop)); a target keeps filling at the target price even when the bar gaps past it (pessimistic: no free gap gain).
// A position still open on the last bar is NOT a trade: it comes back as `openTrade` (marked at the last close) and stays out of stats.
// Slippage hurts every fill; fee is feePct of notional per side (both charged on the unit notional).
const round = (x, d = 4) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

function simulate(candles, sig, risk, costs) {
    const slip = costs.slippagePct / 100;
    const n = candles.length;
    const trades = [], markers = [];
    let pos = null, barsIn = 0, openTrade = null;
    const px = (side, isEntry, p) => (side === 'long') === isEntry ? p * (1 + slip) : p * (1 - slip);
    const close = (t, price, reason) => {
        const exitPx = px(pos.side, false, price);
        const gross = (pos.side === 'long' ? exitPx / pos.entryPrice - 1 : 1 - exitPx / pos.entryPrice) * 100;
        const trade = {
            side: pos.side, entryTime: candles[pos.idx].time, entryPrice: pos.entryPrice, exitTime: candles[t].time,
            exitPrice: exitPx, reason, bars: t - pos.idx + 1, returnPct: gross - 2 * costs.feePct,
        };
        if (reason === 'end') { // not an exit: unrealised, kept out of trades/stats
            openTrade = trade;
            markers.push({ time: candles[t].time, kind: `open_${pos.side}`, price: exitPx });
        } else {
            trades.push(trade);
            markers.push({ time: candles[t].time, kind: reason === 'stop' || reason === 'target' ? reason : `exit_${pos.side}`, price: exitPx });
        }
        pos = null;
    };
    for (let t = 1; t < n; t++) {
        const c = candles[t];
        if (!pos) {
            const side = sig.entryLong[t - 1] ? 'long' : sig.entrySide(t - 1);
            if (side) {
                pos = { side, idx: t, entryPrice: px(side, true, c.open) };
                markers.push({ time: c.time, kind: `entry_${side}`, price: pos.entryPrice });
            }
        } else if (t - 1 >= pos.idx && (pos.side === 'long' ? sig.exitLong : sig.exitShort)[t - 1]) {
            close(t, c.open, 'signal');
        }
        if (!pos) continue;
        barsIn++;
        const dir = pos.side === 'long' ? 1 : -1;
        const stop = risk.stopPct ? pos.entryPrice * (1 - dir * risk.stopPct / 100) : null;
        const target = risk.targetPct ? pos.entryPrice * (1 + dir * risk.targetPct / 100) : null;
        const stopHit = stop !== null && (dir === 1 ? c.low <= stop : c.high >= stop);
        const targetHit = target !== null && (dir === 1 ? c.high >= target : c.low <= target);
        if (stopHit) close(t, dir === 1 ? Math.min(c.open, stop) : Math.max(c.open, stop), 'stop');
        else if (targetHit) close(t, target, 'target');
        else if (risk.maxBars && t - pos.idx + 1 >= risk.maxBars) close(t, c.close, 'maxBars');
    }
    if (pos) close(n - 1, candles[n - 1].close, 'end');
    return { trades, openTrade, markers, barsIn };
}

function stats(candles, trades, barsIn, openTrade = null) {
    const wins = trades.filter((t) => t.returnPct > 0), losses = trades.filter((t) => t.returnPct <= 0);
    const sum = (a) => a.reduce((s, t) => s + t.returnPct, 0);
    let eq = 0, peak = 0, dd = 0;
    for (const t of trades) { eq += t.returnPct; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
    const first = candles[0], last = candles[candles.length - 1];
    return {
        trades: trades.length,
        winRate: trades.length ? round(wins.length / trades.length * 100) : null,
        avgWinPct: wins.length ? round(sum(wins) / wins.length) : null,
        avgLossPct: losses.length ? round(sum(losses) / losses.length) : null,
        profitFactor: losses.length && sum(losses) < 0 && wins.length ? round(sum(wins) / -sum(losses)) : null,
        totalReturnPct: round(sum(trades)),
        maxDrawdownPct: round(dd),
        exposurePct: round(barsIn / candles.length * 100),
        buyHoldPct: first ? round((last.close / first.close - 1) * 100) : null,
        bars: candles.length,
        firstTime: first ? first.time : null,
        lastTime: last ? last.time : null,
        // still open on the last candle: unrealised, NOT counted in trades/winRate/profitFactor/totalReturnPct
        openTrade: openTrade ? { side: openTrade.side, entryTime: openTrade.entryTime, entryPrice: openTrade.entryPrice, markPrice: openTrade.exitPrice, unrealisedPct: round(openTrade.returnPct) } : null,
    };
}

const CAVEATS = Object.freeze([
    'Hypothetical paper results, not real trades.',
    'Tested on the same data it was designed on: in-sample and likely overfit.',
    'Past results do not predict future results.',
    'Signals fill at the next candle open; one position at a time, fixed size, no compounding.',
    'If a stop and a target are both touched in one candle, the stop is assumed to hit first.',
    'Fees and slippage are included on every fill (fee and slippage values are in the request).',
    'Candles come from spot or a fallback exchange and can differ from the exchange you trade on.',
]);
const OPEN_TRADE = 'A position still open on the last candle is excluded from these statistics and shown separately as unrealised.';
const SMALL_SAMPLE = 'Too few trades (under 30) to mean anything.';

module.exports = { simulate, stats, CAVEATS, SMALL_SAMPLE, OPEN_TRADE, round };
