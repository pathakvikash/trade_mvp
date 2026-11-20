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
    await expect(ai.ask('BTCUSDT', 'why?')).resolves.toBe('answer');
    await expect(ai.parseAlert('x')).rejects.toMatchObject({ code: 'ai_refused' });
    ai._test.setClient(null);
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
