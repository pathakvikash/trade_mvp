// Bot performance: pure math (build) with hand-worked numbers, plus the route's ownership. No DB, no network.
jest.mock('../config/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../services/futuresRest', () => ({ overview: jest.fn(async () => []), klines: jest.fn(async () => { throw new Error('no data'); }) }));
jest.mock('../services/tradeFill', () => ({ fillPrice: jest.fn(async () => ({ price: 110, ageMs: 5 })) }));
jest.mock('../models/Strategy', () => ({}));
jest.mock('../models/BotDecision', () => ({ calls: [], find() { const o = { sort: (a) => { this.calls.push(['sort', a]); return o; }, limit: (n) => { this.calls.push(['limit', n]); return o; }, lean: async () => [] }; return o; } }));
jest.mock('../services/strategy/evaluate', () => ({ evaluate: jest.fn(() => { throw new Error('spec does not evaluate'); }) }));
jest.mock('../models/Position', () => ({ rows: [], find(f) { const o = { sort: () => o, lean: async () => this.rows.filter((r) => String(r.botId) === String(f.botId) && String(r.userId) === String(f.userId)) }; return o; } }));
jest.mock('../models/Bot', () => ({ rows: [], findOne(f) { return { lean: async () => (this.rows.find((r) => String(r._id) === String(f._id) && String(r.userId) === String(f.userId)) || null) } } }));

const mongoose = require('mongoose');
const Bot = require('../models/Bot');
const Position = require('../models/Position');
const router = require('../routes/botRoutes');
const BotDecision = require('../models/BotDecision');
const { evaluate } = require('../services/strategy/evaluate');
const { build, interval95, performanceFor } = require('../services/bot/performance');

const oid = () => new mongoose.Types.ObjectId();
const T0 = Date.parse('2026-11-01T00:00:00Z');
const NOW = T0 + 10 * 86400000;
const BOT = { _id: oid(), userId: oid(), symbol: 'BTC', interval: '1h', status: 'running', sizeUsd: 1000, startMark: 100, startedAt: new Date(T0), spec: {} };
// closed position: gross/fees in USD as the ledger stores them
const pos = (gross, fees, extra = {}) => ({ botId: BOT._id, status: 'closed', realizedPnl: gross, fees, openedAt: new Date(T0 + 1000), closedAt: new Date(T0 + 3600000 + 1000), ...extra });
const mix = (n, gross, fees) => Array.from({ length: n }, (_, i) => pos(i % 2 ? -gross : gross, fees));

describe('empty bot', () => {
  test('no trades: zeros, null stats, too-few label, benchmark still computed', () => {
    const r = build(BOT, { mark: 110, now: NOW });
    expect(r.pnl).toMatchObject({ netCents: 0, realizedNetCents: 0, grossCents: 0, feesCents: 0, feesShareOfGross: null });
    expect(r.trades).toMatchObject({ n: 0, winRatePct: null, profitFactor: null, avgTradeCents: null, maxDrawdownCents: 0 });
    expect(r.evidence).toMatchObject({ n: 0, label: 'Too few trades to mean anything', ci95Pct: null, note: null });
    expect(r.window.days).toBe(10);
    expect(r.drift).toMatchObject({ missed: 0, skipped: 0, available: false });
    expect(r.disclosures.join(' ')).toMatch(/no spread/);
    expect(r.disclosures.join(' ')).toMatch(/Funding is not charged/);
  });
});

describe('net P&L and benchmark (hand-worked, cents)', () => {
  // wins +$10 gross, loses -$4 gross, each with $0.50 fees: nets +950, -450, +950
  const positions = [pos(10, 0.5), pos(-4, 0.5), pos(10, 0.5)];
  const r = build(BOT, { positions, mark: 110, now: NOW });
  test('net = gross - fees to the cent; fees share of gross', () => {
    expect(r.pnl).toMatchObject({ grossCents: 1600, feesCents: 150, realizedNetCents: 1450, netCents: 1450, unrealizedCents: 0 });
    expect(r.pnl.feesShareOfGross).toBe(0.0938);
    expect(r.trades).toMatchObject({ n: 3, wins: 2, losses: 1, winRatePct: 66.6667, profitFactor: 4.2222, avgTradeCents: 483, maxDrawdownCents: 450 });
  });
  test('benchmark: $1000 at 100 -> 110 = +10000c gross; fees rounded up on both legs', () => {
    // size 10; entry notional 100000c -> fee 50c; exit 110000c -> fee 55c
    expect(r.benchmark).toMatchObject({ grossCents: 10000, feesCents: 105, netCents: 9895 });
    expect(r.vsBenchmarkCents).toBe(1450 - 9895);
  });
  test('benchmark rounding goes against the user (pnl floors, fee ceils)', () => {
    const b = build({ ...BOT, sizeUsd: 100.01, startMark: 3 }, { mark: 3.001, now: NOW }).benchmark;
    // size floor8(33.33666666)=33.33666666; pnl = 33.33666666*0.001*100 = 3.3336 -> 3c; fees ceil(0.05%*10001c)=6 and ceil(10003.67..)=6 -> never below 1
    expect(b.grossCents).toBe(3);
    expect(b.feesCents).toBe(12);
  });
  test('a liquidated position books -margin as gross; losing mix', () => {
    const l = build(BOT, { positions: [pos(-50, 0.5, { status: 'liquidated' }), pos(-4, 0.5)], mark: 90, now: NOW });
    expect(l.pnl).toMatchObject({ grossCents: -5400, feesCents: 100, realizedNetCents: -5500, feesShareOfGross: null });
    expect(l.trades).toMatchObject({ wins: 0, profitFactor: null, winRatePct: 0 });
    expect(l.benchmark.grossCents).toBe(-10000);
  });
  test('open position: unrealized floored at the mark minus a hypothetical close fee; fees include the open fee', () => {
    const open = { botId: BOT._id, status: 'open', side: 'long', size: 10, entryPrice: 100, fees: 0.5, realizedPnl: 0, openedAt: new Date(T0 + 1000) };
    const r2 = build(BOT, { positions: [open], mark: 101.234, now: NOW });
    // 10 * 1.234 * 100 = 1234c, close fee ceil(0.05% * 101234c) = 51c
    // minus the 50c entry fee already paid: 1234 - 51 - 50
    expect(r2.pnl).toMatchObject({ unrealizedCents: 1133, feesCents: 50, netCents: 1133, feesShareOfGross: null });
    expect(r2.vsBenchmarkCents).toBe(1133 - r2.benchmark.netCents);
    expect(r2.trades).toMatchObject({ n: 0, open: 1 });
    const none = build(BOT, { positions: [open], mark: null, now: NOW });
    expect(none.pnl).toMatchObject({ netCents: null, unrealizedCents: null, markAvailable: false });
    expect(none.benchmark).toBeNull();
  });
  test('forward-only: positions opened before the start, or another bot, are ignored', () => {
    const r3 = build(BOT, { positions: [pos(10, 0.5, { openedAt: new Date(T0 - 1) }), pos(10, 0.5, { botId: oid() })], mark: 110, now: NOW });
    expect(r3.trades.n).toBe(0);
  });
});

describe('sample-size labels and interval', () => {
  const label = (n) => build(BOT, { positions: mix(n, 5, 0.1), mark: 110, now: NOW }).evidence;
  test('thresholds 29 / 30 / 99 / 100', () => {
    expect(label(29).label).toBe('Too few trades to mean anything');
    expect(label(30).label).toBe('Weak evidence');
    expect(label(99).label).toBe('Weak evidence');
    expect(label(100).label).toBeNull();
  });
  test('interval math: mean +/- 1.96 sd / sqrt(n)', () => {
    const i = interval95([1, 3]); // mean 2, sd sqrt(2), half 1.96*sqrt(2)/sqrt(2)=1.96
    expect(i.mean).toBe(2);
    expect(i.high - i.low).toBeCloseTo(3.92, 6);
    expect(interval95([1])).toBeNull();
  });
  test('an interval spanning zero says "Consistent with no edge"; one clear of zero does not', () => {
    const e = label(40); // alternating +5 / -5 gross: mean about 0
    expect(e.ci95Pct.low).toBeLessThan(0);
    expect(e.ci95Pct.high).toBeGreaterThan(0);
    expect(e.note).toBe('Consistent with no edge');
    const win = build(BOT, { positions: Array.from({ length: 40 }, (_, i) => pos(10 + (i % 3) * 0.1, 0.1)), mark: 110, now: NOW }).evidence;
    expect(win.ci95Pct.low).toBeGreaterThan(0);
    expect(win.note).toBeNull();
  });
});

describe('drift', () => {
  const H = 3600;
  const candles = Array.from({ length: 8 }, (_, i) => ({ time: T0 / 1000 + i * H, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  const tick = (action, extra = {}) => ({ kind: 'tick', action, ...extra });
  test('entry fill bps vs next bar open + 2 bps slippage; positive = worse; missed/skip counts by guard', () => {
    const decisions = [
      tick('open_long', { barTime: T0 / 1000, fillPrice: 100.04 }), // bt 100.02 -> +1.9996 bps adverse
      tick('open_short', { barTime: T0 / 1000 + H, fillPrice: 99.98 }), // bt 99.98 -> 0
      tick('open_long', { barTime: T0 / 1000 + 99 * H, fillPrice: 100 }), // no next bar: not counted
      tick('missed'), tick('skip', { reason: { guard: 'daily_loss' } }), tick('skip', { reason: { guard: 'daily_loss' } }), tick('hold'),
      { kind: 'lifecycle' },
    ];
    const d = build(BOT, { decisions, candles, mark: 100, now: NOW }).drift;
    expect(d.entryFill.n).toBe(2);
    expect(d.entryFill.meanAdverseBps).toBe(0.9998); // (1.9996 + 0) / 2
    expect(d).toMatchObject({ missed: 1, skipped: 2, skipReasons: { daily_loss: 2 }, available: true });
  });
  test('sameWindow: exact numbers when the candles cover the whole bot window; null once they do not', () => {
    evaluate.mockReturnValue({ trades: [{ entryTime: T0 / 1000 - H, returnPct: 9 }, { entryTime: T0 / 1000 + H, returnPct: 1.5 }, { entryTime: T0 / 1000 + 2 * H, returnPct: -0.5 }] });
    const positions = [pos(10, 0.5), pos(-4, 0.5)]; // nets +950c, -450c on $1000 -> +0.95% and -0.45%
    const w = build(BOT, { positions, candles, mark: 100, now: NOW }).drift.sameWindow;
    expect(w).toMatchObject({ backtestTrades: 2, backtestReturnPct: 1, liveTrades: 2, liveReturnPct: 0.5 }); // the pre-start trade is excluded
    const later = candles.slice(1); // first candle is after startedAt: the backtest cannot see the bot's first bars
    expect(build(BOT, { positions, candles: later, mark: 100, now: NOW }).drift.sameWindow).toBeNull();
    evaluate.mockImplementation(() => { throw new Error('spec does not evaluate'); });
  });
  test('performanceFor reads the newest 5000 decisions', async () => {
    BotDecision.calls.length = 0;
    await performanceFor(BOT);
    expect(BotDecision.calls).toEqual([['sort', { at: -1 }], ['limit', 5000]]);
  });
  test('fees share counts closed-trade fees only (an open position fee is not in gross)', () => {
    const open = { botId: BOT._id, status: 'open', side: 'long', size: 1, entryPrice: 100, fees: 3, realizedPnl: 0, openedAt: new Date(T0 + 9e6) };
    const r = build(BOT, { positions: [pos(10, 0.5), open], mark: 100, now: NOW });
    expect(r.pnl).toMatchObject({ grossCents: 1000, feesCents: 350, feesShareOfGross: 0.05 });
  });
  test('no candles: drift unavailable but counts still reported', () => {
    const d = build(BOT, { decisions: [tick('missed')], candles: null, now: NOW }).drift;
    expect(d).toMatchObject({ available: false, missed: 1, entryFill: null, sameWindow: null });
  });
});

describe('route: GET /:id/performance', () => {
  const get = (user, id) => new Promise((resolve, reject) => {
    const layer = router.stack.find((l) => l.route && l.route.path === '/:id/performance');
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
    layer.route.stack[0].handle({ params: { id: id }, user: { userId: user }, query: {}, headers: {} }, res, reject);
  });
  beforeEach(() => { Bot.rows.length = 0; Position.rows.length = 0; Bot.rows.push({ ...BOT }); });
  test('owner gets the report; the net matches the bot positions only', async () => {
    Position.rows.push(pos(10, 0.5, { userId: BOT.userId }), pos(99, 0, { userId: BOT.userId, botId: oid() }));
    const r = await get(BOT.userId, String(BOT._id));
    expect(r.status).toBe(200);
    expect(r.body.pnl.realizedNetCents).toBe(950);
    expect(r.body.drift.available).toBe(false); // klines mock throws
  });
  test("another user's bot and a malformed id are 404", async () => {
    expect((await get(oid(), String(BOT._id))).status).toBe(404);
    expect((await get(BOT.userId, 'nope')).status).toBe(404);
  });
});
