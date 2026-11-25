// Pure token search for the header command palette: build one index of everything the user can trade or view, rank it.
// Item: { id, kind: 'token' | 'inst' | 'page', symbol (UPPER, the sort/match key), label, name, cat?, perp?, to? }.
export const MAX_SHOWN = 30;
export const MAX_RECENT = 5;
const SYM_RE = /^[A-Z0-9&-]{1,20}$/; // perp bases and curated instrument symbols (NIFTY50, M&M, BAJAJ-AUTO)

export const baseOf = (s) => String(s?.symbol ?? s ?? '').toUpperCase().replace(/USDT$/, '');

// Everything searchable. perps: /symbols payload (strings or {symbol}); coins: CoinGecko rows for names and spot-only coins;
// instruments: /instruments/quotes rows. A token with no overview row is still listed (price shows as '--').
export function buildIndex({ perps, overview = [], coins = [], instruments = [] }) {
  const names = new Map(coins.map((c) => [String(c.symbol).toUpperCase(), c.name || '']));
  const bases = new Set([...(Array.isArray(perps) ? perps : []).map(baseOf), ...overview.map((r) => baseOf(r.symbol))]);
  const known = bases.size > 0;
  coins.forEach((c) => bases.add(String(c.symbol).toUpperCase()));
  const tokens = [...bases].filter((b) => SYM_RE.test(b)).map((b) => ({
    id: `pal-token-${b}`, kind: 'token', symbol: b, label: b, name: names.get(b) || '',
    // before the perp list is known assume tradable, so quick actions are not withheld while it loads
    perp: !known || (Array.isArray(perps) ? perps.map(baseOf) : []).includes(b) || overview.some((r) => baseOf(r.symbol) === b),
  }));
  const inst = instruments.filter((r) => SYM_RE.test(r.symbol)).map((r) => ({
    id: `pal-inst-${r.symbol}`, kind: 'inst', symbol: r.symbol, label: r.symbol, name: r.name || '', cat: r.category,
  }));
  return [...tokens, ...inst];
}

const subseq = (s, q) => { let i = 0; for (const ch of s) if (ch === q[i]) i += 1; return i === q.length; };

// 0 exact symbol, 1 symbol prefix, 2 name word prefix, 3 symbol substring, 4 name substring, 5 fuzzy (3+ chars), null no match.
export function scoreItem(item, query) {
  const q = query.trim().toUpperCase();
  if (!q) return 0;
  const s = item.symbol;
  const n = (item.name || '').toUpperCase();
  if (s === q) return 0;
  if (s.startsWith(q)) return 1;
  if (n && n.split(/[\s.,&-]+/).some((w) => w.startsWith(q))) return 2;
  if (s.includes(q)) return 3;
  if (n.includes(q)) return 4;
  return q.length >= 3 && subseq(s, q) ? 5 : null;
}

// Ranked matches, best first; ties: tokens before instruments before pages, then most traded, shorter symbol, alphabetical.
// vol: Map(base -> 24h quote volume).
const KIND = { token: 0, inst: 1, page: 2 };
export function rankItems(items, query, vol = new Map()) {
  return items
    .map((it) => [scoreItem(it, query), it])
    .filter(([sc]) => sc !== null)
    .sort((a, b) => a[0] - b[0] || KIND[a[1].kind] - KIND[b[1].kind]
      || (vol.get(b[1].symbol) || 0) - (vol.get(a[1].symbol) || 0)
      || a[1].symbol.length - b[1].symbol.length || (a[1].symbol < b[1].symbol ? -1 : 1))
    .map((x) => x[1]);
}

// Recent picks: [{ k: 'token' | 'inst', s: SYMBOL }], newest first, at most MAX_RECENT. Anything else in storage is dropped.
export const validRecents = (v) => Array.isArray(v) && v.length <= MAX_RECENT
  && v.every((r) => r && (r.k === 'token' || r.k === 'inst') && typeof r.s === 'string' && SYM_RE.test(r.s));
export const addRecent = (list, k, s) => [{ k, s }, ...list.filter((r) => !(r.k === k && r.s === s))].slice(0, MAX_RECENT);

// Empty-query suggestions: recents first, then the most traded, then the biggest 24h movers (from the overview rows). Each carries `why`.
export function suggestions(items, overview, recents) {
  const by = new Map(items.map((i) => [i.id, i]));
  const out = [];
  const seen = new Set();
  const add = (it, why) => { if (it && !seen.has(it.id)) { seen.add(it.id); out.push({ ...it, why }); } };
  recents.forEach((r) => add(by.get(`pal-${r.k}-${r.s}`) || { id: `pal-${r.k}-${r.s}`, kind: r.k, symbol: r.s, label: r.s, name: '', perp: r.k === 'token' }, 'Recent'));
  const rows = [...overview].filter((r) => Number.isFinite(Number(r.quoteVolume)));
  rows.sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 5).forEach((r) => add(by.get(`pal-token-${baseOf(r.symbol)}`), 'Volume'));
  rows.sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent)).slice(0, 3).forEach((r) => add(by.get(`pal-token-${baseOf(r.symbol)}`), 'Mover'));
  return out;
}
