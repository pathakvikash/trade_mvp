export const MAX_ALERTS = 20;
export const MAX_SYMBOLS = 5;
export const METRICS = { price: 'Price', funding: 'Funding rate %', liq_usd_5m: 'Liquidations in 5 min $' };
const SHORT = { price: 'price', funding: 'funding', liq_usd_5m: 'liquidations (5m)' };

export const emptyForm = (symbol = 'BTCUSDT') => ({ symbol, metric: 'price', op: 'above', value: '', note: '', cooldownMin: '15' });

// Returns {field: message}; empty object = valid. `symbols` may be empty while the list loads.
// `used` = symbols of the existing alerts (the server allows at most MAX_SYMBOLS distinct ones).
export function validateAlert(f, count = 0, symbols = [], used = []) {
  const e = {};
  if (count >= MAX_ALERTS) e.form = `Limit of ${MAX_ALERTS} alerts reached.`;
  if (!f.symbol || (symbols.length && !symbols.includes(f.symbol))) e.symbol = 'Pick a symbol.';
  else if (!used.includes(f.symbol) && new Set(used).size >= MAX_SYMBOLS) e.symbol = `Alerts can cover at most ${MAX_SYMBOLS} different symbols.`;
  if (!METRICS[f.metric]) e.metric = 'Pick a metric.';
  if (f.op !== 'above' && f.op !== 'below') e.op = 'Pick above or below.';
  const v = f.value === '' || f.value === null ? NaN : Number(f.value);
  if (!Number.isFinite(v)) e.value = 'Enter a number.';
  else if (f.metric !== 'funding' && v <= 0) e.value = 'Must be greater than 0.';
  const c = Number(f.cooldownMin);
  if (f.cooldownMin === '' || !Number.isInteger(c) || c < 0 || c > 1440) e.cooldownMin = 'Whole minutes, 0-1440.';
  return e;
}

// {symbol:'ETHUSDT', metric:'funding', op:'above', value:0.05} -> "ETHUSDT funding above 0.05%"
export function describeAlert({ symbol, metric, op, value }) {
  const n = Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 });
  return `${symbol} ${SHORT[metric] || metric} ${op} ${metric === 'funding' ? `${n}%` : `$${n}`}`;
}
