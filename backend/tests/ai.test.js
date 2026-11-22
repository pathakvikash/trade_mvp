const Anthropic = require('@anthropic-ai/sdk');
const ai = require('../services/aiService');

test('buildContext trims series to 48, picks 10 nearest liq buckets per side, windows liquidations', () => {
    const now = 10 * 3600e3;
    const arr = (n) => Array.from({ length: n }, (_, i) => ({ ts: i }));
    const levels = Array.from({ length: 30 }, (_, i) => ({ price: 70 + i * 2, longUsd: i % 2 ? 0 : 100 + i, shortUsd: i % 2 ? 50 : 0 }));
    const ctx = ai.buildContext({
        symbol: 'BTCUSDT', overviewRow: { symbol: 'BTCUSDT' },
        stats: { symbol: 'BTCUSDT', period: '1h', openInterest: arr(200), funding: arr(10) },
        liqmap: { price: 100, levels },
        liqEvents: [
            { side: 'long', usd: 10, ts: now - 1000 },
            { side: 'short', usd: 5, ts: now - 2 * 3600e3 },
            { side: 'long', usd: 1, ts: now - 30 * 3600e3 },
        ],
        liqSince: 1, candles: arr(100), now,
    });
    expect(ctx.stats1h.openInterest).toHaveLength(48);
    expect(ctx.stats1h.openInterest[47].ts).toBe(199);
    expect(ctx.stats1h.funding).toHaveLength(10);
    expect(ctx.candles1h).toHaveLength(48);
    expect(ctx.liquidationsSampled['1h']).toEqual({ longUsd: 10, shortUsd: 0, count: 1 });
    expect(ctx.liquidationsSampled['4h']).toEqual({ longUsd: 10, shortUsd: 5, count: 2 });
    expect(ctx.liquidationsSampled['24h'].count).toBe(2);
    const { longLiqNearest: L, shortLiqNearest: S } = ctx.liqMapEstimate;
    expect(L).toHaveLength(10);
    expect(S).toHaveLength(10);
    const dist = (x) => Math.abs(x.price - 100);
    for (let i = 1; i < L.length; i++) expect(dist(L[i])).toBeGreaterThanOrEqual(dist(L[i - 1]));
    expect(Math.max(...L.map(dist))).toBeLessThanOrEqual(Math.min(...levels.filter((l) => l.longUsd > 0 && !L.some((x) => x.price === l.price)).map((l) => dist(l))));
});

const apiErr = (Cls, status) => new Cls(status, { error: { message: 'x' } }, 'x', new Headers());

test('mapError: typed SDK errors, most specific first', () => {
    expect(ai.mapError(apiErr(Anthropic.AuthenticationError, 401))).toEqual({ status: 503, body: { error: 'ai_not_configured' } });
    expect(ai.mapError(apiErr(Anthropic.RateLimitError, 429)).status).toBe(429);
    expect(ai.mapError(apiErr(Anthropic.InternalServerError, 500)).status).toBe(502);
    expect(ai.mapError(new Anthropic.APIConnectionError({ message: 'down' })).status).toBe(502);
    expect(ai.mapError(new Error('Could not resolve authentication method. Expected one of')).status).toBe(503);
    expect(ai.mapError(new Error('boom')).status).toBe(502);
});

test('textOf maps refusal and max_tokens, reads only end_turn', () => {
    const m = (stop_reason) => ({ stop_reason, content: [{ type: 'text', text: 'hi' }] });
    expect(ai.mapError((() => { try { ai.textOf(m('refusal')); } catch (e) { return e; } })()).body.error).toBe('ai_refused');
    expect(ai.mapError((() => { try { ai.textOf(m('max_tokens')); } catch (e) { return e; } })()).body.error).toBe('ai_truncated');
    expect(ai.textOf(m('end_turn'))).toBe('hi');
});

test('request params for the brief: model, effort, fallbacks, no forbidden params', () => {
    const r = ai._test.request('sys', 'u', 'low', { type: 'json_schema' });
    expect(r.model).toBe('claude-opus-5-5');
    expect(r.output_config).toEqual({ effort: 'low', format: { type: 'json_schema' } });
    expect(r.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(r.fallbacks).toBe('default');
    for (const k of ['thinking', 'temperature', 'top_p', 'top_k', 'tool_choice']) expect(r).not.toHaveProperty(k);
});

test('stubbed client: brief maps refusal to a clean error, ask uses the stream final message', async () => {
    ai._test.setClient({ beta: { messages: {
        create: async () => ({ stop_reason: 'refusal', content: [] }),
        stream: () => ({ finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: ' answer ' }] }) }),
    } } });
    const rest = require('../services/futuresRest');
    jest.spyOn(rest, 'overview').mockResolvedValue([]);
    jest.spyOn(rest, 'stats').mockResolvedValue({ symbol: 'BTCUSDT', period: '1h' });
    jest.spyOn(rest, 'liqmap').mockResolvedValue(null);
    jest.spyOn(rest, 'klines').mockResolvedValue([]);
    await expect(ai.brief('BTCUSDT')).rejects.toMatchObject({ status: 422, code: 'ai_refused' });
    await expect(ai.ask('BTCUSDT', 'why?')).resolves.toBe(`answer\n\n${ai.DISCLAIMER}`);
    await expect(ai.parseAlert('x')).rejects.toMatchObject({ code: 'ai_refused' });
    ai._test.setClient(null);
    jest.restoreAllMocks();
});

test('gather: degraded stats count as missing, empty candles do not satisfy the guard, spot candles are labelled', async () => {
    const rest = require('../services/futuresRest');
    const row = [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5 }];
    jest.spyOn(rest, 'overview').mockResolvedValue([]);
    jest.spyOn(rest, 'liqmap').mockResolvedValue(null);
    const stats = jest.spyOn(rest, 'stats').mockResolvedValue({ symbol: 'BTCUSDT', period: '1h', degraded: true, source: 'unavailable' });
    const klines = jest.spyOn(rest, 'klines').mockResolvedValue(Object.defineProperty([...row], 'source', { value: 'spot' }));
    const ctx = await ai._test.gather('BTCUSDT');
    expect(ctx.missing).toContain('open interest / long-short stats');
    expect(ctx.stats1h).toBeNull();
    expect(ctx.candlesSource).toBe('spot');
    klines.mockResolvedValue(row);
    expect((await ai._test.gather('BTCUSDT')).candlesSource).toBe('binance-futures');
    klines.mockResolvedValue([]);
    await expect(ai._test.gather('BTCUSDT')).rejects.toMatchObject({ status: 502, code: 'market_data_unavailable' });
    stats.mockResolvedValue({ symbol: 'BTCUSDT', period: '1h' });
    await expect(ai._test.gather('BTCUSDT')).resolves.toBeTruthy(); // real stats alone are enough
    jest.restoreAllMocks();
});

test('hourlyBudget: max 0 always blocks with a positive integer; 2 allows two then blocks; slot frees after an hour', () => {
    const z = ai.hourlyBudget(0);
    for (let i = 0; i < 3; i++) { const w = z.take(); expect(Number.isInteger(w) && w > 0).toBe(true); }
    let t = 1000;
    const b = ai.hourlyBudget(2, () => t);
    expect(b.take()).toBe(0);
    t += 10e3;
    expect(b.take()).toBe(0);
    t += 10e3;
    expect(b.take()).toBe(3600 - 20);
    t = 1000 + 3600e3;
    expect(b.take()).toBe(0);
    expect(b.take()).toBeGreaterThan(0);
});

test('resolveModel: allow-listed ids pass through, anything else falls back to the env default', () => {
    expect(ai.resolveModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(ai.resolveModel('gpt-4o')).toBe(ai.MODEL);
    expect(ai.resolveModel(null)).toBe(ai.MODEL);
});

test('GET /api/ai/status returns configured plus the signed-in user\'s effective model', async () => {
    const User = require('../models/User');
    const router = require('../routes/aiRoutes');
    jest.spyOn(User, 'findById').mockReturnValue({ select: () => ({ lean: async () => ({ ai: { model: 'claude-sonnet-5-5' } }) }) });
    const layer = router.stack.find((l) => l.route && l.route.path === '/status');
    const res = { json: jest.fn() };
    await layer.route.stack[layer.route.stack.length - 1].handle({ user: { userId: 'u1' } }, res, () => {});
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ configured: expect.any(Boolean), model: 'claude-sonnet-5-5' });
    expect([null, 'api', 'cli']).toContainEqual(body.provider);
    expect(body.configured).toBe(body.provider !== null);
    jest.restoreAllMocks();
});

test('buildContext adds precomputed trend facts and lists missing inputs', () => {
    const c = (close, i) => ({ time: i, open: close, high: close + 1, low: close - 1, close });
    const h = Array.from({ length: 48 }, (_, i) => c(100 + i, i));
    const ctx = ai.buildContext({ symbol: 'BTCUSDT', overviewRow: null, stats: null, liqmap: null, candles: h, daily: [] });
    expect(ctx.trend.shortTerm).toMatchObject({ last: 147, chg4hPct: pctOf(143, 147), chg24hPct: pctOf(123, 147), range48h: { high: 148, low: 99 } });
    expect(ctx.trend.longTerm).toBeNull();
    expect(ctx.missing).toEqual(expect.arrayContaining(['daily candles', 'liquidation map estimate']));
    expect(ctx.missing.join()).not.toContain('1h candles');
});
function pctOf(a, b) { return Math.round((b / a - 1) * 1e4) / 100; }

test('system prompt asks for both sides, both horizons, grounding and confidence', () => {
    for (const s of ['long case and a short case', 'Short-term', 'Long-term', 'Never invent', 'confidence', 'invalidate', 'missing', '180 words']) expect(ai.SYSTEM).toContain(s);
});

test('shapeBrief clips long fields, caps data gaps and appends the disclaimer', () => {
    const long = 'x'.repeat(500);
    const side = { entry: long, invalidation: '1', target: '2' };
    const b = ai.shapeBrief({ headline: long, bias: 'bullish', confidence: 'low', shortTerm: long, longTerm: 'up', long: side, short: side, invalidation: 'below 1', dataGaps: ['a', 'b', 'c', 'd'] });
    expect(b.headline.length).toBeLessThanOrEqual(120);
    expect(b.shortTerm.length).toBeLessThanOrEqual(160);
    expect(b.long.entry.length).toBeLessThanOrEqual(90);
    expect(b.dataGaps).toEqual(['a', 'b', 'c']);
    expect(b.note).toBe(ai.DISCLAIMER);
});

test('shapeAnswer strips markdown and model disclaimers, caps length at a line boundary, appends one disclaimer', () => {
    const out = ai.shapeAnswer('## Answer: **yes**\nLong case: entry 1\n\n\n\nThis is not financial advice.');
    expect(out).toBe(`Answer: yes\nLong case: entry 1\n\n${ai.DISCLAIMER}`);
    const line = 'word '.repeat(50).trim();
    const capped = ai.shapeAnswer(Array(10).fill(line).join('\n'));
    expect(capped.split('\n').filter((l) => l === line)).toHaveLength(4);
});

test('mapError passes an AiError detail through; compactLocal trims the data block for small local contexts', () => {
    expect(ai.mapError(new ai.AiError(502, 'ai_context_too_small', 'n_ctx 8192'))).toEqual({ status: 502, body: { error: 'ai_context_too_small', detail: 'n_ctx 8192' } });
    expect(ai.mapError(new ai.AiError(502, 'ai_upstream_error'))).toEqual({ status: 502, body: { error: 'ai_upstream_error' } });
    const rows = (n) => Array.from({ length: n }, (_, i) => ({ ts: 1763700000000 + i, ratio: i }));
    const candles = Array.from({ length: 48 }, (_, i) => ({ time: 1763700000 + i * 3600, open: 1, high: 2, low: 0.5, close: 1 + i }));
    const levels = Array.from({ length: 40 }, (_, i) => ({ price: 90 + i, longUsd: i < 20 ? 1e6 : 0, shortUsd: i >= 20 ? 1e6 : 0 }));
    const full = ai.buildContext({ symbol: 'BTCUSDT', overviewRow: { symbol: 'BTCUSDT', nextFundingTime: 1763700000000, fundingRate: 0.0001 }, stats: { longShort: rows(200), funding: rows(100) }, liqmap: { price: 110, levels }, liqEvents: [], candles, daily: candles });
    const small = ai.compactLocal(full);
    expect(small.stats1h.longShort).toEqual([42, 43, 44, 45, 46, 47].map((i) => ({ ratio: i + 152 })));
    expect(small.candles1h).toHaveLength(6);
    expect(small.candles1h[5]).toEqual({ open: 1, high: 2, low: 0.5, close: 48 });
    expect(small.liqMapEstimate.longLiqNearest).toHaveLength(5);
    expect(small.overview).toEqual({ symbol: 'BTCUSDT', fundingRate: 0.0001 });
    expect(small.trend).toEqual(full.trend); // the long-range facts survive
    expect(JSON.stringify(small).length).toBeLessThan(JSON.stringify(full).length / 3);
});
