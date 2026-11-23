// Plain-English summary generated in code from the validated spec (never from model text).
const OPS = { crosses_above: 'crosses above', crosses_below: 'crosses below', gt: 'is above', gte: 'is at or above', lt: 'is below', lte: 'is at or below' };
const ind = (d) => {
    const s = d.source || 'close';
    if (d.type === 'sma' || d.type === 'ema' || d.type === 'rsi') return `${d.id} = ${d.type.toUpperCase()}(${s}, ${d.period})`;
    if (d.type === 'bollinger') return `${d.id} = Bollinger Bands(${s}, ${d.period}, ${d.stdDev} SD)`;
    if (d.type === 'macd') return `${d.id} = MACD(${s}, ${d.fast}, ${d.slow}, ${d.signal})`;
    if (d.type === 'atr') return `${d.id} = ATR(${d.period})`;
    return `${d.id} = volume average(${d.period})`;
};
const opnd = (o) => (typeof o === 'number' ? String(o) : typeof o === 'string' ? o : `${o.ref} x ${o.mul}`);
const grp = (g) => (g.all || g.any).map((c) => `${c.left} ${OPS[c.op]} ${opnd(c.right)}`).join(g.all ? ' AND ' : ' OR ');

function describe(spec) {
    const dir = { long: 'long only', short: 'short only', both: 'long and short' }[spec.direction];
    const out = [`Trades ${dir} on ${spec.timeframe} candles.`];
    if (spec.indicators.length) out.push(`Indicators: ${spec.indicators.map(ind).join('; ')}.`);
    for (const w of ['entry', 'exit']) {
        for (const s of ['long', 'short']) {
            const g = spec[w] && spec[w][s];
            if (g) out.push(`${w === 'entry' ? 'Enter' : 'Exit'} ${s} when ${grp(g)}.`);
        }
    }
    const r = spec.risk || {};
    const risk = [r.stopPct && `stop loss ${r.stopPct}%`, r.targetPct && `take profit ${r.targetPct}%`, r.maxBars && `close after ${r.maxBars} bars`].filter(Boolean);
    if (risk.length) out.push(`Risk: ${risk.join(', ')}.`);
    return out.join(' ');
}

module.exports = { describe };
