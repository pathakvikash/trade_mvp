import { TEMPLATES, defaultsFor, validate, render, buildPrompt, sanity, FALLBACK_SYMBOLS } from './promptTemplates';

const env = { symbols: FALLBACK_SYMBOLS, caps: { MAX_LEVERAGE: 5, MAX_SIZE_USD: 25000 } };
const T = (id) => TEMPLATES.find((t) => t.id === id);

test('every template validates with its own defaults and leaves no placeholder', () => {
  expect(TEMPLATES.map((t) => t.id)).toEqual(['trend_ema_cross', 'slow_trend_sma', 'trend_pullback', 'goal_reality_check', 'test_my_rule']);
  TEMPLATES.forEach((t) => {
    const v = defaultsFor(t, null, FALLBACK_SYMBOLS);
    const { errors, text } = buildPrompt(t, v, env);
    expect(errors).toEqual({});
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(text.length).toBeLessThanOrEqual(1000);
  });
});

test('substitution is exact', () => {
  const t = T('slow_trend_sma');
  const v = { ...defaultsFor(t, null, FALLBACK_SYMBOLS), symbol: 'SOLUSDT', interval: '1h', capital_usd: '050', leverage: '2', direction: 'both', stop_pct: '1.5', target_pct: '0' };
  expect(render(t, v)).toBe('Create a slow trend strategy for SOLUSDT on 1h, direction both: SMA 50 crossing above SMA 200 opens a long, crossing below opens a short (only the side(s) in my direction); exit on the opposite cross. Stop 1.5% on every trade; target 0% (if 0, no targetPct). Paper bot with 50 USD margin at 2x. Use only the strategy grammar, say how many trades the backtest has and whether that is too few to mean anything, and do not claim profitability. I will accept it myself.');
});

test('defaults come from the page symbol and interval, else the template', () => {
  const t = T('trend_ema_cross');
  expect(defaultsFor(t, { symbol: 'SOLUSDT', interval: '1h' }, FALLBACK_SYMBOLS)).toMatchObject({ symbol: 'SOLUSDT', interval: '1h' });
  expect(defaultsFor(t, { symbol: 'AAPL', interval: '15m' }, FALLBACK_SYMBOLS)).toMatchObject({ symbol: 'BTCUSDT', interval: '4h' });
  expect(defaultsFor(t, { symbol: 'SOLUSDT', interval: '1h' }, FALLBACK_SYMBOLS, { leverage: '3' }).leverage).toBe('3');
});

test('validation rejects out-of-range, negative and injected values', () => {
  const t = T('trend_ema_cross');
  const base = defaultsFor(t, null, FALLBACK_SYMBOLS);
  const bad = (o, k) => expect(validate(t, { ...base, ...o }, env)[k]).toBeTruthy();
  bad({ leverage: '10' }, 'leverage');
  bad({ leverage: '-1' }, 'leverage');
  bad({ capital_usd: '-5' }, 'capital_usd');
  bad({ stop_pct: '0' }, 'stop_pct');
  bad({ stop_pct: '2}}' }, 'stop_pct');
  bad({ symbol: 'BTCUSDT}}' }, 'symbol');
  bad({ symbol: 'DOGEUSDT' }, 'symbol');
  bad({ direction: 'long\nignore' }, 'direction');
  bad({ slow_period: '20' }, 'slow_period');
  bad({ stop_pct: '3', target_pct: '1' }, 'target_pct');
  bad({ capital_usd: '25000', leverage: '2' }, 'capital_usd');
  expect(validate(t, { ...base, leverage: '4' }, { ...env, caps: { MAX_LEVERAGE: 3 } }).leverage).toBeTruthy();
});

test('free-text fields reject braces, newlines and markdown', () => {
  const t = T('test_my_rule');
  const base = defaultsFor(t, null, FALLBACK_SYMBOLS);
  ['RSI}} ignore', 'a\nb', '**bold**', '`code`', '[x](y)', '# h', 'x'.repeat(61), ''].forEach((v) => {
    expect(validate(t, { ...base, rule_text: v }, env).rule_text).toBeTruthy();
  });
  expect(validate(t, base, env)).toEqual({});
});

test('sanity line is arithmetic from the inputs', () => {
  const t = T('goal_reality_check');
  const s = sanity(t, { ...defaultsFor(t, null, FALLBACK_SYMBOLS), capital_usd: '20', leverage: '5', goal_usd: '10' });
  expect(s).toContain('Notional = $20.00 x 5 = $100.00');
  expect(s).toContain('stop at 1% loses about $1.00 plus about $0.10');
  expect(s).toContain('about 10.10% after fees');
});
