// Strategy DSL v1: strict, inert, declarative. Nothing here (or in this folder) executes spec content.
const { z } = require('zod');

const TIMEFRAME_SECONDS = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const SERIES = ['open', 'high', 'low', 'close', 'volume'];
const MULTI = { bollinger: ['upper', 'middle', 'lower'], macd: ['macd', 'signal', 'hist'] };
const OPS = ['crosses_above', 'crosses_below', 'gt', 'gte', 'lt', 'lte'];
const STRATEGY_LIMITS = Object.freeze({
    maxBytes: 4096, maxIndicators: 8, maxConditions: 6, maxGroups: 4, maxPlot: 8, maxIssues: 20,
    period: [2, 200], stdDev: [0.5, 4], pct: [0.1, 50], maxBars: [1, 500], maxCandles: 1000,
    maxMarkers: 500, maxTrades: 200, timeframes: Object.keys(TIMEFRAME_SECONDS),
});

// control chars plus invisible/bidi formatting (zero-width, LRM/RLM, embeddings/overrides, isolates, BOM): no spoofed or hidden text
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g; // constant pattern, never built from spec content
const ID_RE = /^[a-z][a-z0-9_]{0,15}$/; // ASCII only: homoglyph ids fail here
const REF_RE = /^[a-z][a-z0-9_]{0,15}(\.[a-z]{1,6})?$/;
const text = (max) => z.string().max(max).transform((s) => s.replace(CTRL, ''));

const num = (lo, hi) => z.number().min(lo).max(hi); // zod v4 number() already rejects NaN/Infinity (1e309)
const period = z.number().int().min(STRATEGY_LIMITS.period[0]).max(STRATEGY_LIMITS.period[1]);
const id = z.string().regex(ID_RE);
const source = z.enum(SERIES).optional();
const ind = (type, shape) => z.strictObject({ id, type: z.literal(type), ...shape });

const indicator = z.discriminatedUnion('type', [
    ind('sma', { source, period }), ind('ema', { source, period }), ind('rsi', { source, period }),
    ind('bollinger', { source, period, stdDev: num(...STRATEGY_LIMITS.stdDev) }),
    ind('macd', { source, fast: period, slow: period, signal: period }),
    ind('atr', { period }), ind('volume_sma', { period }),
]);

const ref = z.string().regex(REF_RE);
const operand = z.union([ref, num(-1e9, 1e9), z.strictObject({ ref, mul: num(-1e6, 1e6) })]);
const condition = z.strictObject({ left: ref, op: z.enum(OPS), right: operand });
const conds = z.array(condition).min(1).max(STRATEGY_LIMITS.maxConditions);
const group = z.union([z.strictObject({ all: conds }), z.strictObject({ any: conds })]);
const side = () => z.strictObject({ long: group.optional(), short: group.optional() });
const pct = num(...STRATEGY_LIMITS.pct);

const specSchema = z.strictObject({
    version: z.literal(1),
    name: text(60).refine((s) => s.length >= 1),
    description: text(300).optional(),
    timeframe: z.enum(STRATEGY_LIMITS.timeframes),
    direction: z.enum(['long', 'short', 'both']),
    indicators: z.array(indicator).max(STRATEGY_LIMITS.maxIndicators),
    entry: side(),
    exit: side().optional(),
    risk: z.strictObject({ stopPct: pct.optional(), targetPct: pct.optional(), maxBars: z.number().int().min(1).max(500).optional() }).optional(),
    plot: z.array(id.or(ref)).max(STRATEGY_LIMITS.maxPlot).optional(),
});

const safePath = (p) => p.map(String).join('.').replace(/[^A-Za-z0-9_.]/g, '?').slice(0, 80);
// Messages are fixed or zod's type-only text; unknown key names and input values are never echoed.
const fromZod = (e) => e.issues.map((i) => ({
    path: safePath(i.path),
    message: i.code === 'unrecognized_keys' ? 'unknown key not allowed' : String(i.message).replace(/"[^"]*"/g, '"?"').slice(0, 120),
}));

// Valid operand/plot names: built-in series, single-output ids, and id.field for multi-output ids.
function refTable(spec) {
    const t = new Map(SERIES.map((s) => [s, 1]));
    for (const d of spec.indicators) {
        if (MULTI[d.type]) MULTI[d.type].forEach((f) => t.set(`${d.id}.${f}`, 1));
        else t.set(d.id, 1);
    }
    return t;
}

function semantic(spec) {
    const out = [];
    const bad = (path, message) => out.push({ path, message });
    const seen = new Set(SERIES);
    spec.indicators.forEach((d, i) => {
        if (seen.has(d.id)) bad(`indicators.${i}.id`, 'duplicate or reserved id');
        seen.add(d.id);
        if (d.type === 'macd' && d.fast >= d.slow) bad(`indicators.${i}.fast`, 'macd fast must be less than slow');
    });
    const refs = refTable(spec);
    const checkRef = (r, path) => { if (!refs.has(r)) bad(path, 'reference does not resolve'); };
    let groups = 0;
    for (const where of ['entry', 'exit']) {
        for (const s of ['long', 'short']) {
            const g = spec[where] && spec[where][s];
            if (!g) continue;
            groups++;
            (g.all || g.any).forEach((c, i) => {
                const p = `${where}.${s}.${g.all ? 'all' : 'any'}.${i}`;
                checkRef(c.left, `${p}.left`);
                const r = c.right;
                if (typeof r === 'string') checkRef(r, `${p}.right`);
                else if (r && typeof r === 'object') checkRef(r.ref, `${p}.right.ref`);
            });
        }
    }
    if (groups > STRATEGY_LIMITS.maxGroups) bad('entry', 'too many condition groups');
    const e = spec.entry;
    if (!e.long && !e.short) bad('entry', 'at least one entry group required');
    if (spec.direction === 'long' && (!e.long || e.short)) bad('direction', 'direction long needs only entry.long');
    if (spec.direction === 'short' && (!e.short || e.long)) bad('direction', 'direction short needs only entry.short');
    if (spec.direction === 'both' && !(e.long && e.short)) bad('direction', 'direction both needs entry.long and entry.short');
    if (spec.exit) for (const s of ['long', 'short']) if (spec.exit[s] && !e[s]) bad(`exit.${s}`, 'exit group without matching entry');
    (spec.plot || []).forEach((p, i) => {
        const ok = refs.has(p) || spec.indicators.some((d) => d.id === p && MULTI[d.type]);
        if (!ok || SERIES.includes(p)) bad(`plot.${i}`, 'plot must be an indicator id or field');
    });
    return out;
}

// raw: object or JSON string. Size is checked BEFORE any parsing.
function parseSpec(raw) {
    const fail = (issues) => ({ ok: false, issues: issues.slice(0, STRATEGY_LIMITS.maxIssues) });
    let obj = raw;
    if (typeof raw === 'string') {
        if (raw.length > STRATEGY_LIMITS.maxBytes) return fail([{ path: '', message: 'spec too large' }]);
        try { obj = JSON.parse(raw); } catch { return fail([{ path: '', message: 'not valid JSON' }]); }
    } else {
        let s;
        try { s = JSON.stringify(raw); } catch { return fail([{ path: '', message: 'not serializable' }]); }
        if (s === undefined) return fail([{ path: '', message: 'not serializable' }]);
        if (s.length > STRATEGY_LIMITS.maxBytes) return fail([{ path: '', message: 'spec too large' }]);
    }
    const r = specSchema.safeParse(obj);
    if (!r.success) return fail(fromZod(r.error));
    const issues = semantic(r.data);
    if (issues.length) return fail(issues);
    return { ok: true, spec: r.data };
}

module.exports = { parseSpec, STRATEGY_LIMITS, TIMEFRAME_SECONDS, SERIES, MULTI, refTable };
