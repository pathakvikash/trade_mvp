// Plain-English lines from a stored bot spec. Mirrors backend services/strategy/describe.js (the server text is
// preferred when we have it, i.e. right after creation); this is the fallback after a reload. Never throws on odd specs.
const OPS = { crosses_above: 'crosses above', crosses_below: 'crosses below', gt: 'is above', gte: 'is at or above', lt: 'is below', lte: 'is at or below' };
const opnd = (o) => (typeof o === 'number' || typeof o === 'string' ? String(o) : o && o.ref ? `${o.ref} x ${o.mul}` : '?');
const grp = (g) => (g.all || g.any || []).map((c) => `${c.left} ${OPS[c.op] || c.op} ${opnd(c.right)}`).join(g.all ? ' AND ' : ' OR ');

export default function describeSpec(spec) {
  const s = spec || {};
  const out = [];
  const dir = { long: 'long only', short: 'short only', both: 'long and short' }[s.direction];
  if (dir) out.push(`Trades ${dir}.`);
  for (const w of ['entry', 'exit']) {
    for (const side of ['long', 'short']) {
      const g = s[w]?.[side];
      if (g && (g.all || g.any)) out.push(`${w === 'entry' ? 'Enters' : 'Exits'} ${side} when ${grp(g)}.`);
    }
  }
  if (s.risk?.maxBars) out.push(`Closes a trade after ${s.risk.maxBars} candles at most.`);
  return out;
}
