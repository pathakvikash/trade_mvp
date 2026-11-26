// Pure helpers for the AI chat's structured answers. Every field of the backend reply may be missing, so all of this tolerates junk.
export const TRADE_INTENT = /\b(trade|strategy|bot|enter|go ahead)\b/i;
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Clamp a plan's size/leverage to the server's hard caps (GET /api/bots/config .caps). Returns only the fields it can set.
export const clampPlan = (plan, caps = {}) => {
  const out = {};
  if (isNum(plan?.sizeUsd) && plan.sizeUsd > 0) out.sizeUsd = Math.min(plan.sizeUsd, isNum(caps.MAX_SIZE_USD) ? caps.MAX_SIZE_USD : plan.sizeUsd);
  if (isNum(plan?.leverage) && plan.leverage >= 1) out.leverage = Math.min(Math.max(1, Math.round(plan.leverage)), isNum(caps.MAX_LEVERAGE) ? caps.MAX_LEVERAGE : 5);
  return out;
};

// Levels with a numeric price, nearest to `price` first, each with its signed distance in %.
export const rankLevels = (levels, price) => (Array.isArray(levels) ? levels : [])
  .filter((l) => l && isNum(l.price))
  .map((l) => ({ ...l, dist: isNum(price) && price !== 0 ? ((l.price - price) / price) * 100 : null }))
  .sort((a, b) => (a.dist == null || b.dist == null ? 0 : Math.abs(a.dist) - Math.abs(b.dist)));

// Light markdown for the plain-text fallback: one entry per line, bullets tagged, **bold** split into parts.
export const mdLines = (text) => String(text ?? '').split('\n').map((raw) => {
  const bullet = /^\s*[-*•]\s+/.test(raw);
  const body = bullet ? raw.replace(/^\s*[-*•]\s+/, '') : raw;
  return { bullet, parts: body.split(/\*\*(.+?)\*\*/g).map((t, i) => ({ t, b: i % 2 === 1 })) };
});
