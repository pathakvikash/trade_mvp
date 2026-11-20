// Pure money maths for leveraged paper futures (USDT-margined linear, isolated margin).
// Engine amounts are integer cents. Stored dollar fields on Position are cents / 100, so pos.margin is USD and
// pos.size / pos.entryPrice are coins / USD. See docs/phase2-leverage.md section 1 and 3.
const { notionalCents, round8 } = require('./tradeMath');

const TAKER_FEE_BPS = 5;
const DEFAULT_MAX_LEV = 20;
const SYMBOL_MAX_LEV = { BTC: 50, ETH: 50 };
const TIERS = [
  { maxNotional: 50000, maxLev: 50, mmr: 0.004 },
  { maxNotional: 250000, maxLev: 20, mmr: 0.005 },
  { maxNotional: 1000000, maxLev: 10, mmr: 0.01 },
  { maxNotional: 5000000, maxLev: 5, mmr: 0.025 },
  { maxNotional: Infinity, maxLev: 2, mmr: 0.05 },
];

// Float noise (499.99999999) must not flip a ceil/floor: round to 6 dp first, as notionalCents does. `|| 0` turns -0 into 0.
const ceilCents = (x) => Math.ceil(Math.round(x * 1e6) / 1e6) || 0;
const floorCents = (x) => Math.floor(Math.round(x * 1e6) / 1e6) || 0;

const feeOf = (notional) => Math.max(1, ceilCents((notional * TAKER_FEE_BPS) / 10000));
const marginOf = (notional, lev) => ceilCents(notional / lev);

function tierOf(notionalUsd) {
  return TIERS.find((t) => notionalUsd <= t.maxNotional);
}

function maxLeverage(symbol, notionalUsd) {
  const symCap = Object.prototype.hasOwnProperty.call(SYMBOL_MAX_LEV, symbol) ? SYMBOL_MAX_LEV[symbol] : DEFAULT_MAX_LEV;
  return Math.min(symCap, tierOf(notionalUsd).maxLev);
}

// marginUsd is the isolated margin in USD (after adds). Clamped at 0: at 1x with rounding the raw value can dip below 0.
function liqPrice(side, entry, size, marginUsd, mmr) {
  const perCoin = marginUsd / size;
  const raw = side === 'long' ? (entry - perCoin) / (1 - mmr) : (entry + perCoin) / (1 + mmr);
  return Math.max(0, round8(raw));
}

// -> cents: { notional, fee, margin, debit, mmr, liqPrice (USD) }
function openQuote(side, size, price, lev) {
  const notional = notionalCents(size, price);
  const fee = feeOf(notional);
  const margin = marginOf(notional, lev);
  const mmr = tierOf(notional / 100).mmr;
  return { notional, fee, margin, debit: margin + fee, mmr, liqPrice: liqPrice(side, price, size, margin / 100, mmr) };
}

// pos: Position fields (USD margin). Leverage must equal pos.leverage (the caller enforces LEVERAGE_MISMATCH).
// Tier cap on the combined notional is the caller's check: maxLeverage(pos.symbol, size * entryPrice) >= pos.leverage.
// -> { size (coins), entryPrice (USD, size-weighted), margin (cents, total), mmr, liqPrice (USD), fee (cents, add only), debit (cents, add only) }
function addQuote(pos, size, price) {
  const addNotional = notionalCents(size, price);
  const addMargin = marginOf(addNotional, pos.leverage);
  const addFee = feeOf(addNotional);
  const newSize = round8(pos.size + size);
  const entryPrice = round8((pos.size * pos.entryPrice + size * price) / newSize);
  const margin = Math.round(pos.margin * 100) + addMargin;
  const mmr = tierOf(newSize * entryPrice).mmr;
  return {
    size: newSize,
    entryPrice,
    margin,
    mmr,
    liqPrice: liqPrice(pos.side, entryPrice, newSize, margin / 100, mmr),
    fee: addFee,
    debit: addMargin + addFee,
  };
}

// closeSize equal to pos.size is the final close (releases all remaining margin). Otherwise released is pro rata.
// -> cents: { pnl (gross), fee, released, credit }. Liquidation credit is 0 and not computed here.
function closeQuote(pos, closeSize, exit) {
  if (!(closeSize > 0) || round8(closeSize) > round8(pos.size)) throw new RangeError('closeSize out of range');
  const isFinal = round8(closeSize) === round8(pos.size);
  const marginCents = Math.round(pos.margin * 100);
  const sign = pos.side === 'long' ? 1 : -1;
  const pnl = floorCents(100 * sign * closeSize * (exit - pos.entryPrice));
  const fee = feeOf(notionalCents(closeSize, exit));
  const released = isFinal ? marginCents : floorCents((marginCents * closeSize) / pos.size);
  return { pnl, fee, released, credit: Math.max(0, released + pnl - fee) };
}

// Display only, USD, unrounded. roe is percent of the USD margin.
function unrealized(pos, mark) {
  const sign = pos.side === 'long' ? 1 : -1;
  const pnl = sign * pos.size * (mark - pos.entryPrice);
  return { pnl, roe: (pnl / pos.margin) * 100 };
}

module.exports = {
  TAKER_FEE_BPS,
  SYMBOL_MAX_LEV,
  DEFAULT_MAX_LEV,
  TIERS,
  tierOf,
  maxLeverage,
  liqPrice,
  openQuote,
  addQuote,
  closeQuote,
  unrealized,
};
