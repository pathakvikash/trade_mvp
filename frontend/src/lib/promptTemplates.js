// Prompt-template starters for the AI chat. Data: promptTemplates.json (copy of context/bot-prompt-templates.json).
// Pure helpers: validate -> render -> sanity. The text that is previewed is the text that is sent; values only ever
// enter it after passing a strict per-field pattern, so no free text (braces, newlines, markdown) can be injected.
import data from './promptTemplates.json';
import { TAKER_FEE_BPS } from './futuresMath';

export const TEMPLATES = data.templates;
export const LABEL = data.label;
export const DISCLAIMER = data.disclaimer;
export const BADGE = 'Learning starter, not a profit promise';
export const MAX_PROMPT = 1000; // the chat input's maxLength
export const FALLBACK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT'];

const INTS = ['leverage', 'fast_period', 'slow_period', 'trend_period', 'rsi_level'];
const TEXT_RE = /^[A-Za-z0-9 .,()<>=_/+-]{1,60}$/; // indicators, numbers, comparison words: no braces, quotes, newlines or markdown
const INT_RE = /^\d{1,6}$/;
const NUM_RE = /^\d{1,6}(\.\d{1,2})?$/;

export const LABELS = {
  symbol: 'Symbol', interval: 'Interval', capital_usd: 'Margin (USD)', leverage: 'Leverage (x)', direction: 'Direction',
  fast_period: 'Fast EMA period', slow_period: 'Slow EMA period', trend_period: 'Trend EMA period', rsi_level: 'RSI entry below',
  stop_pct: 'Stop (%)', target_pct: 'Target (%, 0 = none)', goal_usd: 'Profit goal (USD)', window: 'Within', rule_text: 'Entry rule', exit_text: 'Exit rule',
};

export const kindOf = (name, spec) => {
  if (name === 'symbol') return 'symbol';
  if (spec.allowed) return 'select';
  if (spec.min != null) return INTS.includes(name) ? 'int' : 'num';
  return 'text';
};

const cap = (v, c) => (typeof c === 'number' && Number.isFinite(c) ? Math.min(v, c) : v);
// effective [min, max] for a numeric field: the template's range tightened by the server's /api/bots/config caps
export const rangeOf = (name, spec, caps = {}) => {
  let { min, max } = spec;
  if (name === 'leverage') max = cap(max, caps.MAX_LEVERAGE);
  if (name === 'capital_usd') max = cap(max, caps.MAX_SIZE_USD);
  return [min, max];
};

const symbolOk = (v, symbols) => /^[A-Z0-9]{2,20}USDT$/.test(v) && symbols.includes(v);

// Initial form values: template default, then the last-used values, then the page's symbol/interval (the page wins).
export const defaultsFor = (tpl, ctx, symbols, saved) => {
  const out = {};
  for (const [name, spec] of Object.entries(tpl.placeholders)) {
    const s = saved?.[name];
    out[name] = typeof s === 'string' ? s : String(spec.default);
  }
  if (tpl.placeholders.symbol && symbolOk(String(ctx?.symbol), symbols)) out.symbol = ctx.symbol;
  if (tpl.placeholders.interval && tpl.placeholders.interval.allowed.includes(ctx?.interval)) out.interval = ctx.interval;
  return out;
};

export const validate = (tpl, values, { symbols = FALLBACK_SYMBOLS, caps = {} } = {}) => {
  const errs = {};
  for (const [name, spec] of Object.entries(tpl.placeholders)) {
    const v = values[name];
    const label = LABELS[name] || name;
    const kind = kindOf(name, spec);
    if (typeof v !== 'string') { errs[name] = `${label} is required.`; continue; }
    if (kind === 'symbol') { if (!symbolOk(v, symbols)) errs[name] = 'Pick a symbol from the list.'; continue; }
    if (kind === 'select') { if (!spec.allowed.includes(v)) errs[name] = `${label} must be one of: ${spec.allowed.join(', ')}.`; continue; }
    if (kind === 'text') { if (!TEXT_RE.test(v)) errs[name] = `${label}: 1-60 characters, letters, numbers, spaces and . , ( ) < > = + - _ / only.`; continue; }
    const [min, max] = rangeOf(name, spec, caps);
    if (!(kind === 'int' ? INT_RE : NUM_RE).test(v)) { errs[name] = `${label} must be a ${kind === 'int' ? 'whole ' : ''}number, no signs or letters.`; continue; }
    const n = Number(v);
    if (n < min || n > max) errs[name] = `${label} must be between ${min} and ${max}.`;
  }
  const P = tpl.placeholders;
  const n = (k) => Number(values[k]);
  if (P.fast_period && P.slow_period && !errs.fast_period && !errs.slow_period && n('slow_period') <= n('fast_period')) errs.slow_period = 'Slow period must be greater than the fast period.';
  if (P.target_pct && P.stop_pct && !errs.target_pct && !errs.stop_pct && n('target_pct') > 0 && n('target_pct') < n('stop_pct')) errs.target_pct = 'Target must be at least the stop, or 0 for none.';
  if (P.capital_usd && P.leverage && !errs.capital_usd && !errs.leverage) {
    const notional = n('capital_usd') * n('leverage');
    const lo = caps.MIN_NOTIONAL_USD ?? 5;
    const hi = caps.MAX_SIZE_USD ?? 25000;
    if (notional < lo || notional > hi) errs.capital_usd = `Margin x leverage (${notional}) must be between ${lo} and ${hi} USD.`;
  }
  return errs;
};

// Placeholder substitution. Call only with validated values; numbers are normalised ("02" -> 2).
export const render = (tpl, values) => tpl.prompt.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  const spec = tpl.placeholders[k];
  const v = values[k];
  return spec && ['int', 'num'].includes(kindOf(k, spec)) ? String(Number(v)) : v;
});

// -> { errors, text } where text is null while anything is invalid (or the prompt would not fit the chat input)
export const buildPrompt = (tpl, values, env) => {
  const errors = validate(tpl, values, env);
  if (Object.keys(errors).length) return { errors, text: null };
  const text = render(tpl, values);
  if (text.length > MAX_PROMPT) return { errors: { form: `Prompt would be ${text.length} characters; the chat allows ${MAX_PROMPT}. Shorten the text fields.` }, text: null };
  return { errors, text };
};

const usd = (x) => `$${x.toFixed(2)}`;
// Local arithmetic from the inputs; null while capital/leverage are not valid numbers. Never a forecast.
export const sanity = (tpl, values) => {
  const P = tpl.placeholders;
  const n = (k) => Number(values[k]);
  if (!P.capital_usd || !P.leverage || !NUM_RE.test(values.capital_usd) || !INT_RE.test(values.leverage)) return null;
  const notional = n('capital_usd') * n('leverage');
  const fees = (notional * 2 * TAKER_FEE_BPS) / 10000;
  const parts = [`Notional = ${usd(n('capital_usd'))} x ${n('leverage')} = ${usd(notional)}`];
  if (P.stop_pct && NUM_RE.test(values.stop_pct)) parts.push(`stop at ${n('stop_pct')}% loses about ${usd((notional * n('stop_pct')) / 100)} plus about ${usd(fees)} round-trip taker fees`);
  if (P.target_pct && NUM_RE.test(values.target_pct) && n('target_pct') > 0) parts.push(`target at ${n('target_pct')}% gains about ${usd((notional * n('target_pct')) / 100)} before fees`);
  if (P.goal_usd && NUM_RE.test(values.goal_usd) && notional > 0) parts.push(`a ${usd(n('goal_usd'))} goal needs a price move of about ${(((n('goal_usd') + fees) / notional) * 100).toFixed(2)}% after fees`);
  return `${parts.join('; ')}.`;
};
