// Pure bot risk rules in integer cents; each limit at its boundary (exactly met vs one cent over).
const g = require('../services/bot/riskGuard');
const { botHash } = require('../services/strategy/hash');

const SPEC = { risk: { stopPct: 2 }, entry: {} };
// $1000 notional = 100000c; stop 2% = 2000c; fees 2 x 50c => worst case 2100c per trade.
const mk = (o = {}) => ({
    _id: 'b1', symbol: 'BTC', interval: '1h', spec: SPEC, sizeUsd: 1000, leverage: 1, positionId: null,
    limits: { maxPositionUsd: 1000, maxLeverage: 1, dailyLossUsd: 100, maxTradesPerDay: 10, symbols: ['BTC'] }, ...o,
});
const KEY = '2026-11-26';
const st = (o = {}) => ({ allowed: ['BTC', 'ETH'], dayKey: KEY, day: { key: KEY, trades: 0, realizedCents: 0 }, unrealizedCents: 0, ...o });
const entry = { type: 'entry' };
const code = (bot, state, intent = entry) => { const r = g.check(bot, state, intent); return r.ok ? 'ok' : r.code; };

test('a sane bot passes; worst case is 2100 cents', () => {
    expect(code(mk(), st())).toBe('ok');
    expect(g.worstCaseCents(100000, 2)).toBe(2100);
});

test('allow-list: server list and the bot limits both apply', () => {
    expect(code(mk(), st({ allowed: ['ETH'] }))).toBe('SYMBOL_NOT_ALLOWED');
    expect(code(mk({ limits: { ...mk().limits, symbols: ['ETH'] } }), st())).toBe('SYMBOL_NOT_ALLOWED');
});

test('leverage: above the bot limit, above the hard 5x cap, above the tier cap', () => {
    expect(code(mk({ leverage: 2 }), st())).toBe('LEVERAGE_LIMIT');
    expect(code(mk({ leverage: 6, limits: { ...mk().limits, maxLeverage: 6 } }), st())).toBe('LEVERAGE_LIMIT');
    // 5x at 6M notional: tier cap is 2x
    expect(code(mk({ leverage: 5, limits: { ...mk().limits, maxLeverage: 5 } }), st(), { type: 'entry', notionalCents: 6e8 })).toBe('LEVERAGE_LIMIT');
});

test('position limit: exactly met passes, one cent over fails (notional rounds up)', () => {
    expect(code(mk(), st())).toBe('ok');
    expect(code(mk(), st(), { type: 'entry', notionalCents: 100001 })).toBe('POSITION_LIMIT');
    expect(code(mk({ sizeUsd: 1000.001 }), st())).toBe('POSITION_LIMIT'); // ceil to 100001c
});

test('trades per day: 9 of 10 passes, 10 fails; a stale day counts as zero', () => {
    expect(code(mk(), st({ day: { key: KEY, trades: 9, realizedCents: 0 } }))).toBe('ok');
    expect(code(mk(), st({ day: { key: KEY, trades: 10, realizedCents: 0 } }))).toBe('TRADES_LIMIT');
    expect(code(mk(), st({ day: { key: '2026-11-25', trades: 10, realizedCents: -99999 } }))).toBe('ok');
});

test('daily loss kill switch: at the limit blocks, one cent inside does not trip DAILY_LOSS; unrealized counts', () => {
    const day = (realizedCents) => ({ key: KEY, trades: 0, realizedCents });
    expect(code(mk(), st({ day: day(-10000) }))).toBe('DAILY_LOSS');
    expect(code(mk(), st({ day: day(-5000), unrealizedCents: -5000 }))).toBe('DAILY_LOSS');
    expect(code(mk(), st({ day: day(-9999) }))).toBe('LOSS_BUDGET'); // not killed, but no room for a trade
    expect(g.dailyLossHit(mk(), day(-10000), 0, KEY)).toBe(true);
    expect(g.dailyLossHit(mk(), day(-9999), 0, KEY)).toBe(false);
    expect(g.dailyLossHit(mk(), day(-9000), -1000, KEY)).toBe(true);
});

test('worst-case trade must fit the remaining loss budget: 2100c fits exactly, 2101c does not', () => {
    // budget 10000c; realized -7900 leaves exactly 2100
    expect(code(mk(), st({ day: { key: KEY, trades: 0, realizedCents: -7900 } }))).toBe('ok');
    expect(code(mk(), st({ day: { key: KEY, trades: 0, realizedCents: -7901 } }))).toBe('LOSS_BUDGET');
    expect(code(mk({ limits: { ...mk().limits, dailyLossUsd: 21 } }), st())).toBe('ok');
    expect(code(mk({ limits: { ...mk().limits, dailyLossUsd: 20.99 } }), st())).toBe('LOSS_BUDGET');
});

test('stop must sit inside liquidation: 5x with a 25% stop fails, 19% passes', () => {
    const lim = { ...mk().limits, maxLeverage: 5, dailyLossUsd: 1000 };
    const b = (stopPct) => mk({ leverage: 5, limits: lim, spec: { risk: { stopPct } } });
    expect(code(b(25), st())).toBe('STOP_BEYOND_LIQ');
    expect(code(b(19), st())).toBe('ok');
    expect(g.stopInsideLiq(19, 5, 100000)).toBe(true);
    expect(g.stopInsideLiq(21, 5, 100000)).toBe(false);
});

test('no stop, no entry', () => {
    expect(code(mk({ spec: { risk: {} } }), st())).toBe('STOP_REQUIRED');
    expect(g.staticProblem(mk({ spec: {} }))).toBe('STOP_REQUIRED');
});

test('a position on the same side blocks unless it is the bot\'s own', () => {
    expect(code(mk(), st({ conflict: { _id: 'p9' } }))).toBe('POSITION_CONFLICT');
    expect(code(mk({ positionId: 'p9' }), st({ conflict: { _id: 'p9' } }))).toBe('ok');
});

test('exits are never blocked, whatever is violated', () => {
    const worst = mk({ leverage: 9, limits: { ...mk().limits, symbols: [] } });
    const s = st({ allowed: [], day: { key: KEY, trades: 99, realizedCents: -1e9 }, conflict: { _id: 'x' } });
    expect(code(worst, s)).not.toBe('ok');
    expect(code(worst, s, { type: 'exit' })).toBe('ok');
});

describe('validateLimits', () => {
    const allowed = ['BTC', 'ETH'];
    test('defaults: $1000, 1x, $50 a day, 10 trades', () => {
        const r = g.validateLimits({}, allowed, 'BTC');
        expect(r).toEqual({ ok: true, value: { sizeUsd: 1000, leverage: 1, limits: { maxPositionUsd: 1000, maxLeverage: 1, dailyLossUsd: 50, maxTradesPerDay: 10, symbols: ['BTC'] } } });
    });
    test.each([
        [{ leverage: 6 }], [{ leverage: 1.5 }], [{ sizeUsd: 25000.01 }], [{ sizeUsd: 4 }], [{ sizeUsd: NaN }],
        [{ limits: { maxLeverage: 6 } }], [{ limits: { maxPositionUsd: 25001 } }], [{ limits: { maxPositionUsd: 999 } }],
        [{ limits: { dailyLossUsd: 0 } }], [{ limits: { maxTradesPerDay: 0 } }], [{ limits: { symbols: ['DOGE'] } }],
        [{ limits: { symbols: ['ETH'] } }], [{ limits: { evil: 1 } }],
    ])('rejects %j', (input) => expect(g.validateLimits(input, allowed, 'BTC').ok).toBe(false));
    test('hard caps themselves are accepted', () => {
        expect(g.validateLimits({ sizeUsd: 25000, leverage: 5, limits: { maxPositionUsd: 25000, maxLeverage: 5 } }, allowed, 'BTC').ok).toBe(true);
    });
});

describe('hash', () => {
    const base = { spec: SPEC, symbol: 'BTC', interval: '1h', sizeUsd: 1000, leverage: 1, limits: mk().limits };
    test('stable under key order; changes with the spec or any limit', () => {
        const h = botHash(base);
        expect(botHash({ ...base, limits: { symbols: ['BTC'], maxTradesPerDay: 10, dailyLossUsd: 100, maxLeverage: 1, maxPositionUsd: 1000 } })).toBe(h);
        for (const change of [{ sizeUsd: 1001 }, { leverage: 2 }, { interval: '4h' }, { symbol: 'ETH' }, { spec: { risk: { stopPct: 3 } } },
            { limits: { ...base.limits, dailyLossUsd: 101 } }, { limits: { ...base.limits, symbols: ['BTC', 'ETH'] } }]) {
            expect(botHash({ ...base, ...change })).not.toBe(h);
        }
    });
});

describe('claimTrade (conditional counter)', () => {
    // One-document fake: an update is atomic, like Mongo's single-document guarantee.
    const fake = (day) => {
        const doc = { _id: 'b1', day };
        const Bot = {
            doc,
            updateOne: async (f, u) => { const c = f['day.key']; // supports $lt (and $ne, so a regression to $ne would rewind the day and fail the older-key test)
                if ('$lt' in c ? doc.day.key < c.$lt : doc.day.key !== c.$ne) doc.day = { ...u.$set.day }; },
            findOneAndUpdate: async (f, u) => {
                if (doc.day.key !== f['day.key'] || !(doc.day.trades < f['day.trades'].$lt)) return null;
                doc.day.trades += u.$inc['day.trades'];
                return doc;
            },
        };
        return Bot;
    };
    test('two concurrent claims at max-1: exactly one wins', async () => {
        const Bot = fake({ key: KEY, trades: 9, realizedCents: 0 });
        const r = await Promise.all([g.claimTrade(Bot, mk(), KEY), g.claimTrade(Bot, mk(), KEY)]);
        expect(r.filter(Boolean)).toHaveLength(1);
        expect(Bot.doc.day.trades).toBe(10);
    });
    test('a new UTC day rolls the counter first', async () => {
        const Bot = fake({ key: '2026-11-25', trades: 10, realizedCents: -500 });
        expect(await g.claimTrade(Bot, mk(), KEY)).toBe(true);
        expect(Bot.doc.day).toEqual({ key: KEY, trades: 1, realizedCents: 0 });
    });
    test('an older key (stale clock / late worker) never rewinds the day or touches today\'s counter', async () => {
        const Bot = fake({ key: KEY, trades: 4, realizedCents: -300 });
        expect(await g.claimTrade(Bot, mk(), '2026-11-25')).toBe(false);
        expect(Bot.doc.day).toEqual({ key: KEY, trades: 4, realizedCents: -300 });
    });
    test('refused when the bot is no longer running or its accepted hash changed (pause/stop/edit since the snapshot)', async () => {
        const Bot = fake({ key: KEY, trades: 0, realizedCents: 0 });
        const orig = Bot.findOneAndUpdate;
        Bot.doc.status = 'stopped';
        Bot.findOneAndUpdate = async (f, u) => (f.status === Bot.doc.status && f.acceptedHash === 'h1' ? orig(f, u) : null);
        expect(await g.claimTrade(Bot, mk({ acceptedHash: 'h1' }), KEY)).toBe(false);
        Bot.doc.status = 'running';
        expect(await g.claimTrade(Bot, mk({ acceptedHash: 'h2' }), KEY)).toBe(false);
        expect(await g.claimTrade(Bot, mk({ acceptedHash: 'h1' }), KEY)).toBe(true);
    });
    test('limit reached -> false, counter unchanged', async () => {
        const Bot = fake({ key: KEY, trades: 10, realizedCents: 0 });
        expect(await g.claimTrade(Bot, mk(), KEY)).toBe(false);
        expect(Bot.doc.day.trades).toBe(10);
    });
});

test('warm-up: a spec needing more closed candles than the engine fetches (499) is a static problem', () => {
    const ema = (period) => ({ ...SPEC, indicators: [{ id: 'e', type: 'ema', source: 'close', period }] });
    expect(g.warmupNeed(ema(166))).toBe(498);
    expect(g.staticProblem(mk({ spec: ema(166) }))).toBeNull();
    expect(g.warmupNeed(ema(167))).toBe(501);
    expect(g.staticProblem(mk({ spec: ema(167) }))).toBe('WARMUP_TOO_LONG');
});

test('the guard and the routes never reach an order path or AI/news code', () => {
    const fs = require('fs');
    for (const f of ['services/bot/riskGuard.js', 'routes/botRoutes.js']) {
        const src = fs.readFileSync(`${__dirname}/../${f}`, 'utf8');
        const reqs = [...src.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
        expect(reqs.filter((r) => /futuresController|futuresOrders|futuresLedger|services\/ai|aiService|aiProviders|news/.test(r))).toEqual([]);
    }
});
