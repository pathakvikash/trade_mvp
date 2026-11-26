// Pure risk rules for bots, integer cents. Nothing here touches a DB, the network or an order path (claimTrade takes the
// Bot model as an argument so this file stays require-free of models). Plan: context/bot-trading-plan.md section 2.
const { ceilCents, feeOf, maxLeverage, liqPrice, tierOf } = require('../futuresMath');
const { WARMUP_MIN, WARMUP_MULT } = require('../strategy/evaluate');

const CAPS = { MAX_BOTS: 5, MAX_RUNNING: 3, MAX_RUNNING_PROCESS: 200, MAX_LEVERAGE: 5, MAX_SIZE_USD: 25000 };
const DEFAULTS = { sizeUsd: 1000, leverage: 1, dailyLossUsd: 50, maxTradesPerDay: 10 };
const INTERVALS = ['5m', '15m', '1h', '4h', '1d'];
const MIN_NOTIONAL_USD = 5;
// The engine fetches KLINE_LIMIT candles per bar; the newest is still forming, so at most KLINE_LIMIT - 1 are closed.
const KLINE_LIMIT = 500;
const MAX_CLOSED = KLINE_LIMIT - 1;

const cents = (usd) => Math.round(usd * 100);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const dayKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 10); // UTC

// Is a stop `stopPct` away from entry still inside the liquidation price? Reference price 100, both sides: liq is
// scale-free in entry, so this needs no mark. At the tier's mmr; notional only picks the tier.
function stopInsideLiq(stopPct, leverage, notionalCents) {
  const mmr = tierOf(notionalCents / 100).mmr;
  const size = 1;
  const margin = 100 / leverage; // USD: notional 100 / leverage
  const longLiq = liqPrice('long', 100, size, margin, mmr);
  const shortLiq = liqPrice('short', 100, size, margin, mmr);
  return 100 * (1 - stopPct / 100) > longLiq && 100 * (1 + stopPct / 100) < shortLiq;
}

// Worst case of one trade: the stop is hit (rounded up) plus an entry fee and an exit fee.
const worstCaseCents = (notionalCents, stopPct) => ceilCents((notionalCents * stopPct) / 100) + 2 * feeOf(notionalCents);

// Validates and normalises the user-facing parameters. `allowed` = server allow-list of base tickers.
// -> { ok: true, value: { sizeUsd, leverage, limits } } | { ok: false, error }
function validateLimits(input, allowed, symbol) {
  const sizeUsd = input.sizeUsd === undefined ? DEFAULTS.sizeUsd : input.sizeUsd;
  const leverage = input.leverage === undefined ? DEFAULTS.leverage : input.leverage;
  const l = input.limits === undefined ? {} : input.limits;
  if (!l || typeof l !== 'object' || Array.isArray(l)) return { ok: false, error: 'invalid limits' };
  const extra = Object.keys(l).filter((k) => !['maxPositionUsd', 'maxLeverage', 'dailyLossUsd', 'maxTradesPerDay', 'symbols'].includes(k));
  if (extra.length) return { ok: false, error: 'unexpected limits field' };
  if (!isNum(sizeUsd) || sizeUsd < MIN_NOTIONAL_USD || sizeUsd > CAPS.MAX_SIZE_USD) return { ok: false, error: `sizeUsd must be ${MIN_NOTIONAL_USD}..${CAPS.MAX_SIZE_USD}` };
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > CAPS.MAX_LEVERAGE) return { ok: false, error: `leverage must be an integer 1..${CAPS.MAX_LEVERAGE}` };
  const limits = {
    maxPositionUsd: l.maxPositionUsd === undefined ? sizeUsd : l.maxPositionUsd,
    maxLeverage: l.maxLeverage === undefined ? leverage : l.maxLeverage,
    dailyLossUsd: l.dailyLossUsd === undefined ? DEFAULTS.dailyLossUsd : l.dailyLossUsd,
    maxTradesPerDay: l.maxTradesPerDay === undefined ? DEFAULTS.maxTradesPerDay : l.maxTradesPerDay,
    symbols: l.symbols === undefined ? [symbol] : l.symbols,
  };
  if (!isNum(limits.maxPositionUsd) || limits.maxPositionUsd < sizeUsd || limits.maxPositionUsd > CAPS.MAX_SIZE_USD) return { ok: false, error: 'maxPositionUsd must be sizeUsd..cap' };
  if (!Number.isInteger(limits.maxLeverage) || limits.maxLeverage < leverage || limits.maxLeverage > CAPS.MAX_LEVERAGE) return { ok: false, error: 'maxLeverage must be leverage..5' };
  if (!isNum(limits.dailyLossUsd) || limits.dailyLossUsd <= 0 || limits.dailyLossUsd > 1e6) return { ok: false, error: 'invalid dailyLossUsd' };
  if (!Number.isInteger(limits.maxTradesPerDay) || limits.maxTradesPerDay < 1 || limits.maxTradesPerDay > 100) return { ok: false, error: 'maxTradesPerDay must be 1..100' };
  const s = limits.symbols;
  if (!Array.isArray(s) || !s.length || s.length > 40 || s.some((x) => typeof x !== 'string' || !allowed.includes(x))) return { ok: false, error: 'symbols must be allow-listed' };
  if (!s.includes(symbol)) return { ok: false, error: 'symbols must contain the bot symbol' };
  limits.symbols = [...new Set(s)];
  return { ok: true, value: { sizeUsd, leverage, limits } };
}

// Closed candles signalAt needs before it will signal (same formula as strategy/evaluate). A spec needing more than the engine
// fetches would sit in warm-up forever.
const warmupNeed = (spec) => Math.max(WARMUP_MIN, WARMUP_MULT * Math.max(1, ...(spec.indicators || []).map((d) => d.period || (d.slow + d.signal))));

// Checks that depend only on the bot's own parameters (used at accept so a bad bot can never be approved).
// -> null | code
function staticProblem(bot) {
  const stopPct = bot.spec && bot.spec.risk && bot.spec.risk.stopPct;
  if (!isNum(stopPct) || !(stopPct > 0)) return 'STOP_REQUIRED';
  if (warmupNeed(bot.spec) > MAX_CLOSED) return 'WARMUP_TOO_LONG';
  const notional = ceilCents(bot.sizeUsd * 100);
  if (bot.leverage > bot.limits.maxLeverage || bot.limits.maxLeverage > CAPS.MAX_LEVERAGE || bot.leverage > maxLeverage(bot.symbol, notional / 100)) return 'LEVERAGE_LIMIT';
  if (notional > cents(bot.limits.maxPositionUsd)) return 'POSITION_LIMIT';
  if (!stopInsideLiq(stopPct, bot.leverage, notional)) return 'STOP_BEYOND_LIQ';
  if (worstCaseCents(notional, stopPct) > cents(bot.limits.dailyLossUsd)) return 'LOSS_BUDGET';
  return null;
}

// check(bot, state, intent) -> { ok: true } | { ok: false, code }
//   state:  { allowed: [base tickers], day: {key,trades,realizedCents}, dayKey, unrealizedCents, conflict?: { _id } }
//           conflict = a position on userId:symbol:side (any owner); it blocks unless it is this bot's own position.
//   intent: { type: 'entry' | 'exit', notionalCents? } (entry notional defaults to the bot's sizeUsd, rounded up)
// Exits are never blocked: closing only ever reduces risk.
function check(bot, state, intent) {
  if (intent.type === 'exit') return { ok: true };
  const L = bot.limits;
  const fail = (code) => ({ ok: false, code });
  if (!L.symbols.includes(bot.symbol) || !(state.allowed || []).includes(bot.symbol)) return fail('SYMBOL_NOT_ALLOWED');
  const notional = intent.notionalCents === undefined ? ceilCents(bot.sizeUsd * 100) : intent.notionalCents;
  if (bot.leverage > L.maxLeverage || L.maxLeverage > CAPS.MAX_LEVERAGE || bot.leverage > maxLeverage(bot.symbol, notional / 100)) return fail('LEVERAGE_LIMIT');
  if (notional > cents(L.maxPositionUsd)) return fail('POSITION_LIMIT');
  const today = state.dayKey || dayKey();
  const day = state.day && state.day.key === today ? state.day : { trades: 0, realizedCents: 0 };
  if (day.trades >= L.maxTradesPerDay) return fail('TRADES_LIMIT');
  const pnl = day.realizedCents + (state.unrealizedCents || 0);
  const lossCents = cents(L.dailyLossUsd);
  if (pnl <= -lossCents) return fail('DAILY_LOSS');
  const stopPct = bot.spec.risk && bot.spec.risk.stopPct;
  if (!isNum(stopPct) || !(stopPct > 0)) return fail('STOP_REQUIRED');
  if (worstCaseCents(notional, stopPct) > lossCents + pnl) return fail('LOSS_BUDGET');
  if (!stopInsideLiq(stopPct, bot.leverage, notional)) return fail('STOP_BEYOND_LIQ');
  if (state.conflict && String(state.conflict._id) !== String(bot.positionId)) return fail('POSITION_CONFLICT');
  return { ok: true };
}

// Kill switch test for the engine: true once today's realised + open P&L reaches the daily loss limit.
const dailyLossHit = (bot, day, unrealizedCents, key = dayKey()) =>
  (day && day.key === key ? day.realizedCents : 0) + (unrealizedCents || 0) <= -cents(bot.limits.dailyLossUsd);

// Trade counter as a conditional claim, never read-then-write: roll the day forward first ($lt: an older key can never rewind the day), then
// $inc only while trades < max AND the bot is still running with the hash it was accepted under (it is the last write before the
// order, so a pause/stop/stop-all/edit since the pass snapshot refuses it). Two concurrent claims at max-1: exactly one gets true.
// false = refused for either reason.
async function claimTrade(Bot, bot, key = dayKey()) {
  await Bot.updateOne({ _id: bot._id, 'day.key': { $lt: key } }, { $set: { day: { key, trades: 0, realizedCents: 0 } } });
  const r = await Bot.findOneAndUpdate(
    { _id: bot._id, status: 'running', acceptedHash: bot.acceptedHash, 'day.key': key, 'day.trades': { $lt: bot.limits.maxTradesPerDay } },
    { $inc: { 'day.trades': 1 } },
    { new: true },
  );
  return !!r;
}

module.exports = { MIN_NOTIONAL_USD, KLINE_LIMIT, MAX_CLOSED, warmupNeed, CAPS, DEFAULTS, INTERVALS, dayKey, validateLimits, staticProblem, stopInsideLiq, worstCaseCents, check, dailyLossHit, claimTrade };
