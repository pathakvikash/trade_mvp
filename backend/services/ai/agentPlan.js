// Pure helpers for the analyst reply: trade-intent detection, the `structured` answer schema and the plan sanity check.
// No model, no DB, no order path: the plan is advisory data shown in the UI; only the user's Accept on the bot screen starts anything.
const { z } = require('zod');
const { CAPS, MIN_NOTIONAL_USD, stopInsideLiq } = require('../bot/riskGuard');

// Cheap keyword test on the user's text. A hit runs the request in strategy mode even when the client flag is off.
// Bare "long"/"short" are NOT triggers (funding / long-short-ratio questions are analysis, not trade requests).
const TRADE_RE = /\b(trades?|trading|strateg(?:y|ies)|bots?|enter|entry|scalp|buy|sell|go ahead|go (?:long|short)|(?:long|short) it|(?:open|take|place) (?:a )?(?:long|short|position|trade)|make (?:me )?(?:\$\s?\d|\d+\s*(?:usd|usdt|dollars?|\$)))/i;
const tradeIntent = (message) => TRADE_RE.test(String(message || ''));

const NOTICE = "Nothing runs until you accept it on the bot screen; 'go ahead' in chat is not acceptance and no order was placed.";

const Str = (n) => z.string().max(n);
const Level = z.object({ label: Str(40), price: z.number().positive().finite(), kind: z.enum(['support', 'resistance', 'liquidation', 'invalidation', 'target']) });
const Plan = z.object({
    side: z.enum(['long', 'short']), entry: z.number().positive().finite(), stop: z.number().positive().finite(), target: z.number().positive().finite(),
    sizeUsd: z.number().positive().finite(), leverage: z.number().int().min(1).max(CAPS.MAX_LEVERAGE), riskUsd: z.number().positive().finite(), rewardUsd: z.number().positive().finite(),
    rr: z.number().positive().finite(), horizon: Str(60),
});
// plan/levels stay unknown here: a bad plan is DROPPED on its own, it must not cost the rest of the structured answer
const Structured = z.object({
    verdict: z.enum(['long', 'short', 'neutral', 'avoid']), confidence: z.enum(['low', 'medium', 'high']),
    headline: Str(120), summary: Str(400),
    plan: z.unknown().optional(), levels: z.unknown().optional(),
    bull: z.array(Str(200)).max(4), bear: z.array(Str(200)).max(4), risks: z.array(Str(200)).max(4),
    needsData: z.array(Str(100)).max(8).optional(),
});

// Mark the plan must be near: live ws mark, else overview mark/last. Perp only (bots trade perps).
const markOf = (ctx) => [ctx.live && ctx.live.markPrice, ctx.overview && ctx.overview.markPrice, ctx.overview && ctx.overview.lastPrice].find((x) => typeof x === 'number' && x > 0) || null;
const close = (a, b, absTol, relTol) => Math.abs(a - b) <= Math.max(absTol, relTol * Math.abs(b));

/** -> plan | null. Null means "inconsistent: drop it", never "fix it". */
function checkPlan(raw, ctx) {
    if (raw === undefined || raw === null || !ctx || ctx.kind !== 'perp') return null;
    const p = Plan.safeParse(raw);
    const mark = markOf(ctx);
    if (!p.success || !mark) return null;
    const { side, entry, stop, target, sizeUsd, leverage, riskUsd, rewardUsd, rr } = p.data;
    if (Math.abs(entry - mark) / mark > 0.03) return null; // entry within 3% of mark
    if (side === 'long' ? !(stop < entry && entry < target) : !(target < entry && entry < stop)) return null; // stop/target on the right side
    if (sizeUsd < MIN_NOTIONAL_USD || sizeUsd > CAPS.MAX_SIZE_USD) return null; // sizeUsd is NOTIONAL, as for bots
    const stopPct = (Math.abs(entry - stop) / entry) * 100;
    const targetPct = (Math.abs(target - entry) / entry) * 100;
    if (stopPct > 50 || targetPct > 50) return null; // the strategy grammar's own bound
    if (!stopInsideLiq(stopPct, leverage, Math.round(sizeUsd * 100))) return null; // stop must sit inside liquidation
    if (!close(riskUsd, (sizeUsd * stopPct) / 100, 0.05, 0.15)) return null;
    if (!close(rewardUsd, (sizeUsd * targetPct) / 100, 0.05, 0.15)) return null;
    if (!close(rr, rewardUsd / riskUsd, 0.1, 0.15)) return null;
    return { ...p.data, stopPct: +stopPct.toFixed(3), targetPct: +targetPct.toFixed(3) };
}

/** -> structured | null (null = fall back to plain text). `spec` = the accepted strategy spec, when there is one. */
function checkStructured(raw, ctx, spec) {
    if (raw === undefined || raw === null) return null;
    const s = Structured.safeParse(raw);
    if (!s.success) return null;
    const { plan: rawPlan, levels: rawLevels, ...rest } = s.data;
    const out = { ...rest };
    const plan = checkPlan(rawPlan, ctx);
    if (plan) {
        const r = spec && spec.risk;
        // linked = the proposed strategy's stop/target/side agree with the plan, so Accept on the bot screen matches what chat showed
        plan.linked = !!(r && close(r.stopPct || 0, plan.stopPct, 0.1, 0.2) && close(r.targetPct || 0, plan.targetPct, 0.1, 0.2) && (spec.direction === 'both' || spec.direction === plan.side));
        out.plan = plan;
    }
    const levels = (Array.isArray(rawLevels) ? rawLevels : []).map((l) => Level.safeParse(l)).filter((l) => l.success).map((l) => l.data).slice(0, 8);
    if (levels.length) out.levels = levels;
    return out;
}

module.exports = { tradeIntent, checkStructured, checkPlan, NOTICE, TRADE_RE };
