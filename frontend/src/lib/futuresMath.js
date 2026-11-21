// Client-side mirror of the backend futures maths (docs/phase2-leverage.md §1, §3, §4). Previews only: the server is
// authoritative. Units: every quote money field (notional, fee, margin, debit, pnl, released, credit) is an integer
// cents value, as in the spec vectors. Position inputs use the stored USD fields (pos.margin, pos.entryPrice, ...).
// unrealized() returns USD (display only). liqPrice() returns USD.

export const TAKER_FEE_BPS = 5;
export const DEFAULT_MAX_LEV = 20;
export const SYMBOL_MAX_LEV = { BTC: 50, ETH: 50 };

// Position notional in USD (<=) -> max leverage and maintenance margin rate. Last tier has no upper bound.
export const TIERS = [
  { maxNotional: 50_000, maxLev: 50, mmr: 0.004 },
  { maxNotional: 250_000, maxLev: 20, mmr: 0.005 },
  { maxNotional: 1_000_000, maxLev: 10, mmr: 0.01 },
  { maxNotional: 5_000_000, maxLev: 5, mmr: 0.025 },
  { maxNotional: Infinity, maxLev: 2, mmr: 0.05 },
];

// Float-safe floor/ceil at cent scale (1e-9 absorbs artefacts such as 28.999999999999996).
const floorC = (x) => Math.floor(x + 1e-9);
const ceilC = (x) => Math.ceil(x - 1e-9);

// Same definition as backend tradeMath.notionalCents: cents, rounded to 1e-6 of a cent.
export const notionalCents = (size, price) => Math.round(size * price * 100 * 1e6) / 1e6;
// fee = max(1, ceil(notional * 5 / 10000)) cents
export const feeCents = (notional, config) => Math.max(1, ceilC(notional * (config?.takerFeeRate ?? TAKER_FEE_BPS / 10000)));

// Optional `config` ({ tiers, symbolMaxLev, defaultMaxLev, takerFeeRate }) is the server's /api/futures/config; when
// given it replaces the local constants so previews match the server. Server tiers use maxNotional null = unbounded.
export const tierOf = (notionalUsd, config) => {
  const tiers = config?.tiers?.length ? config.tiers : TIERS;
  return tiers.find((t) => t.maxNotional == null || notionalUsd <= t.maxNotional) || tiers[tiers.length - 1];
};

export const maxLeverage = (symbol, notionalUsd, config) => {
  const symCap = (config?.symbolMaxLev || SYMBOL_MAX_LEV)[symbol] ?? config?.defaultMaxLev ?? DEFAULT_MAX_LEV;
  return Math.min(symCap, tierOf(notionalUsd, config).maxLev);
};

// Isolated, linear. Liquidated when M + pnl(mark) <= mmr * size * mark. M in USD, fees excluded.
export const liqPrice = (side, entry, size, marginUsd, mmr) => {
  const perCoin = marginUsd / size;
  const raw = side === 'long' ? (entry - perCoin) / (1 - mmr) : (entry + perCoin) / (1 + mmr);
  return Math.max(0, raw); // a price cannot go negative (matches the backend)
};

// Open (or limit reservation) at price with leverage. Returns cents, liqPrice in USD.
export const openQuote = (side, size, price, lev, config) => {
  const notional = notionalCents(size, price);
  const fee = feeCents(notional, config);
  const margin = ceilC(notional / lev);
  const mmr = tierOf(size * price, config).mmr;
  return {
    notional,
    fee,
    margin,
    debit: margin + fee,
    mmr,
    liqPrice: liqPrice(side, price, size, margin / 100, mmr),
  };
};

// Partial or full close at exit. Partial release is pro-rata; a final close releases all remaining margin.
// credit = max(0, released + pnl - fee). Liquidation credit is 0 (not a close; see the engine).
export const closeQuote = (pos, closeSize, exit) => {
  const delta = pos.side === 'long' ? exit - pos.entryPrice : pos.entryPrice - exit;
  const pnl = floorC(100 * closeSize * delta);
  const fee = feeCents(notionalCents(closeSize, exit));
  const marginCents = Math.round(pos.margin * 100);
  const isFinal = closeSize >= pos.size - 1e-9;
  const released = isFinal ? marginCents : floorC((marginCents * closeSize) / pos.size);
  return { pnl, fee, released, credit: Math.max(0, released + pnl - fee) };
};

// Add at price, same leverage as the open position (the caller enforces that). New entry is size-weighted; margin
// grows by the new leg's margin; tier and mmr are taken from the combined notional. Returns cents for money fields.
export const addQuote = (pos, size, price, lev = pos.leverage, config) => {
  const newSize = pos.size + size;
  const entryPrice = (pos.size * pos.entryPrice + size * price) / newSize;
  const addNotional = notionalCents(size, price);
  const fee = feeCents(addNotional, config);
  const addMargin = ceilC(addNotional / lev);
  const margin = Math.round(pos.margin * 100) + addMargin;
  const mmr = tierOf(newSize * entryPrice, config).mmr;
  return {
    size: newSize,
    entryPrice,
    margin,
    mmr,
    liqPrice: liqPrice(pos.side, entryPrice, newSize, margin / 100, mmr),
    fee,
    debit: addMargin + fee,
  };
};

// Leverage change on an open position (mirrors backend futuresMath.leverageQuote): isolated margin re-sized on the ENTRY
// notional with the open rounding (ceil); mmr stays as stored on the position. Cents: margin (new total) and delta
// (+ = released to the balance, - = extra margin debited). liqPrice in USD.
export const leverageQuote = (pos, lev, config) => {
  const margin = ceilC(notionalCents(pos.size, pos.entryPrice) / lev);
  const mmr = pos.mmr ?? tierOf(pos.size * pos.entryPrice, config).mmr;
  return { margin, delta: Math.round(pos.margin * 100) - margin, liqPrice: liqPrice(pos.side, pos.entryPrice, pos.size, margin / 100, mmr) };
};

// Display-only unrealised PnL (USD) and ROE (%) on isolated margin.
export const unrealized = (pos, mark) => {
  const pnl = pos.side === 'long' ? pos.size * (mark - pos.entryPrice) : pos.size * (pos.entryPrice - mark);
  return { pnl, roe: pos.margin > 0 ? (pnl / pos.margin) * 100 : 0 };
};
