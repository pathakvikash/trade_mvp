// Forward-only performance of one bot, from ledger-settled Position rows (botId) vs buy-and-hold, plus backtest-vs-live drift.
// Pure math in `build` (integer cents; percents/bps are display-only floats); `performanceFor` does the queries.
// Plan: context/bot-trading-plan.md section 1. No model text, no ranking, no "profitable" label, no projection.
const Position = require('../../models/Position');
const BotDecision = require('../../models/BotDecision');
const futuresRest = require('../futuresRest');
const tradeFill = require('../tradeFill');
const { feeOf } = require('../futuresMath');
const { notionalCents } = require('../tradeMath');
const { evaluate } = require('../strategy/evaluate');
const { EVAL_SECONDS } = require('../strategy/schema');

const SLIPPAGE_PCT = 0.02; // the backtest default (evaluate); drift compares live fills with this model
const LABEL_FEW = 'Too few trades to mean anything';
const LABEL_WEAK = 'Weak evidence';
const NO_EDGE = 'Consistent with no edge';
const DISCLOSURES = [
  'Paper money only. Fills are simulated at the mark price with no spread or depth, so real fills would be worse.',
  'Funding is not charged. Real perpetual positions pay or receive funding, so real results would differ.',
  'Past and paper results do not predict future results. Not financial advice.',
];

const cents = (usd) => Math.round((usd || 0) * 100);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : null);
const floorC = (x) => Math.floor(Math.round(x * 1e6) / 1e6) || 0; // PnL rounds down: the house never loses a cent
const sum = (a) => a.reduce((s, x) => s + x, 0);

const sampleLabel = (n) => (n < 30 ? LABEL_FEW : n < 100 ? LABEL_WEAK : null);

// mean +/- 1.96 * sd / sqrt(n), sample sd; needs n >= 2.
function interval95(rets) {
  const n = rets.length;
  if (n < 2) return null;
  const mean = sum(rets) / n;
  const sd = Math.sqrt(sum(rets.map((r) => (r - mean) ** 2)) / (n - 1));
  const half = (1.96 * sd) / Math.sqrt(n);
  return { mean, sd, low: mean - half, high: mean + half };
}

function build(bot, { positions = [], decisions = [], mark = null, candles = null, now = Date.now() } = {}) {
  const sizeCents = Math.ceil(bot.sizeUsd * 100);
  const from = bot.startedAt ? new Date(bot.startedAt).getTime() : null;
  const mine = positions.filter((p) => String(p.botId) === String(bot._id) && (from === null || new Date(p.openedAt).getTime() >= from));
  const closed = mine.filter((p) => p.status === 'closed' || p.status === 'liquidated')
    .sort((a, b) => new Date(a.closedAt || a.updatedAt) - new Date(b.closedAt || b.updatedAt));
  const open = mine.find((p) => p.status === 'open') || null;

  // Per closed position: gross = realizedPnl (liquidation books -margin), fees = open + close fees; net = gross - fees.
  const t = closed.map((p) => {
    const gross = cents(p.realizedPnl), fees = cents(p.fees);
    return { gross, fees, net: gross - fees, ret: ((gross - fees) / sizeCents) * 100, ms: new Date(p.closedAt || p.updatedAt) - new Date(p.openedAt) };
  });
  const grossC = sum(t.map((x) => x.gross));
  const closedFeesC = sum(t.map((x) => x.fees));
  let feesC = closedFeesC;
  const realizedNet = sum(t.map((x) => x.net));

  let unrealized = null;
  let openMs = 0;
  if (open) {
    feesC += cents(open.fees);
    openMs = now - new Date(open.openedAt).getTime();
    if (mark > 0) {
      const sign = open.side === 'long' ? 1 : -1;
      // both legs' fees come off: the entry fee already paid and the hypothetical close fee, so the open leg is not flattered
      unrealized = floorC(sign * open.size * (mark - open.entryPrice) * 100) - feeOf(notionalCents(open.size, mark)) - cents(open.fees);
    }
  } else unrealized = 0;
  const netCents = unrealized === null ? null : realizedNet + unrealized;

  const wins = t.filter((x) => x.net > 0), losses = t.filter((x) => x.net <= 0);
  const lossSum = -sum(losses.map((x) => x.net));
  let eq = 0, peak = 0, dd = 0;
  for (const x of t) { eq += x.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const windowMs = from === null ? 0 : Math.max(0, now - from);
  const exposureMs = sum(t.map((x) => x.ms)) + openMs;

  // Buy-and-hold: the same notional bought at the mark recorded at first start, held to now, one entry and one exit fee.
  let benchmark = null;
  if (bot.startMark > 0 && mark > 0) {
    const size = Math.floor((bot.sizeUsd / bot.startMark) * 1e8) / 1e8;
    const entryFee = feeOf(notionalCents(size, bot.startMark)), exitFee = feeOf(notionalCents(size, mark));
    const gross = floorC(size * (mark - bot.startMark) * 100);
    benchmark = { notionalCents: sizeCents, startMark: bot.startMark, endMark: mark, grossCents: gross, feesCents: entryFee + exitFee, netCents: gross - entryFee - exitFee };
  }

  const rets = t.map((x) => x.ret);
  const iv = interval95(rets);
  const evidence = {
    n: t.length,
    label: sampleLabel(t.length),
    meanReturnPct: iv ? r4(iv.mean) : t.length ? r4(rets[0]) : null,
    sdPct: iv ? r4(iv.sd) : null,
    ci95Pct: iv ? { low: r4(iv.low), high: r4(iv.high) } : null,
    note: iv && iv.low <= 0 && iv.high >= 0 ? NO_EDGE : null,
    basis: 'Net return per closed trade as a percent of the bot size, after fees.',
  };

  // Drift: only what the data can show. Entries compare with the backtest fill (next bar open + slippage).
  const ticks = decisions.filter((d) => d.kind === 'tick');
  const skipReasons = {};
  ticks.filter((d) => d.action === 'skip').forEach((d) => { const k = (d.reason && d.reason.guard) || 'unknown'; skipReasons[k] = (skipReasons[k] || 0) + 1; });
  const drift = {
    missed: ticks.filter((d) => d.action === 'missed').length,
    skipped: ticks.filter((d) => d.action === 'skip').length,
    skipReasons,
    entryFill: null, sameWindow: null, available: false,
  };
  const ivSec = EVAL_SECONDS[bot.interval];
  if (Array.isArray(candles) && candles.length && ivSec) {
    drift.available = true;
    const byTime = new Map(candles.map((c) => [c.time, c]));
    const slip = SLIPPAGE_PCT / 100;
    const bps = [];
    for (const d of ticks) {
      if ((d.action !== 'open_long' && d.action !== 'open_short') || !(d.fillPrice > 0)) continue;
      const next = byTime.get(d.barTime + ivSec);
      if (!next) continue;
      const long = d.action === 'open_long';
      const bt = next.open * (long ? 1 + slip : 1 - slip);
      bps.push(((long ? d.fillPrice - bt : bt - d.fillPrice) / bt) * 1e4); // positive = live fill worse than the backtest's
    }
    drift.entryFill = { n: bps.length, meanAdverseBps: bps.length ? r4(sum(bps) / bps.length) : null, note: 'Positive means the live paper fill was worse than the backtest fill for the same signal.' };
    // candles hold only the last ~500 bars: once the bot is older than that the backtest window would differ from the live one
    if (from !== null && from >= candles[0].time * 1000) {
      try {
        const ev = evaluate(bot.spec, candles, { interval: bot.interval, now });
        const fromSec = from / 1000;
        const btTrades = ev.trades.filter((x) => x.entryTime >= fromSec);
        drift.sameWindow = { backtestTrades: btTrades.length, backtestReturnPct: r4(sum(btTrades.map((x) => x.returnPct))), liveTrades: t.length, liveReturnPct: r4(sum(rets)), note: 'Both are the sum of per-trade returns on a fixed notional, after fees; the backtest also applies slippage.' };
      } catch (e) { /* spec no longer evaluates: leave sameWindow null */ }
    }
  }

  return {
    botId: String(bot._id), symbol: bot.symbol, interval: bot.interval, status: bot.status,
    window: { from: from === null ? null : new Date(from).toISOString(), to: new Date(now).toISOString(), days: r4(windowMs / 86400000) },
    pnl: {
      netCents, realizedNetCents: realizedNet, unrealizedCents: unrealized, grossCents: grossC, feesCents: feesC,
      feesShareOfGross: grossC > 0 ? r4(closedFeesC / grossC) : null, // closed trades only (gross is closed-only); not defined when gross is <= 0
      markAvailable: unrealized !== null,
    },
    benchmark,
    vsBenchmarkCents: benchmark && netCents !== null ? netCents - benchmark.netCents : null,
    trades: {
      n: t.length, open: open ? 1 : 0, wins: wins.length, losses: losses.length,
      winRatePct: t.length ? r4((wins.length / t.length) * 100) : null,
      profitFactor: wins.length && lossSum > 0 ? r4(sum(wins.map((x) => x.net)) / lossSum) : null,
      avgTradeCents: t.length ? Math.round(realizedNet / t.length) : null,
      maxDrawdownCents: dd,
      exposurePct: windowMs > 0 ? r4(Math.min(100, (exposureMs / windowMs) * 100)) : null,
    },
    evidence,
    drift,
    disclosures: DISCLOSURES,
  };
}

async function performanceFor(bot) {
  const [positions, decisions] = await Promise.all([
    Position.find({ botId: bot._id, userId: bot.userId }).sort({ openedAt: 1 }).lean(),
    BotDecision.find({ botId: bot._id, userId: bot.userId, kind: 'tick' }).sort({ at: -1 }).limit(5000).lean(),
  ]);
  let mark = null;
  try { const f = await tradeFill.fillPrice(`${bot.symbol}USDT`); if (f && f.price > 0) mark = f.price; } catch (e) { /* no fresh mark: unrealized and benchmark are null */ }
  let candles = null;
  try { candles = await futuresRest.klines(`${bot.symbol}USDT`, bot.interval, 500); } catch (e) { /* drift shows unavailable */ }
  return build(bot, { positions, decisions, mark, candles });
}

module.exports = { build, performanceFor, interval95, sampleLabel, LABEL_FEW, LABEL_WEAK, NO_EDGE, DISCLOSURES };
