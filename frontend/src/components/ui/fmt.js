const num = (n) => (n == null || n === '' ? NaN : Number(n));

export const fmtPrice = (n) => {
  const v = num(n);
  if (!Number.isFinite(v)) return '--';
  const a = Math.abs(v);
  // below 0.01 fixed decimals would round tiny prices to zero, so keep significant digits instead
  // (5, so adjacent order-book ticks like 0.0037812 / 0.0037813 stay distinguishable)
  if (a < 0.01 && a > 0) return v.toLocaleString('en-US', { maximumSignificantDigits: 5 });
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: a >= 1000 ? 2 : a >= 1 ? 4 : 6 });
};

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
export const fmtUsd = (n) => {
  const v = num(n);
  return Number.isFinite(v) ? usd.format(v) : '--';
};

// undefined = the browser locale decides (preference "auto"). ponytail: module state, so a changed preference shows on each
// component's next render rather than instantly everywhere; upgrade path: put it in a store if that ever matters.
let hour12;
export const setTimeFormat = (f) => { hour12 = f === '12h' ? true : f === '24h' ? false : undefined; };
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12 });

// hh:mm:ss until `ms` elapse; '--' when there is nothing to count down to
export const fmtCountdown = (ms) => {
  if (!(ms > 0)) return '--';
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

export const fmtCompact = (n) => {
  const v = num(n);
  return Number.isFinite(v) ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(v) : '--';
};

export const fmtPct = (n, digits = 2) => {
  const v = num(n);
  return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : '--';
};

export const fmtQty = (n) => {
  const v = num(n);
  if (!Number.isFinite(v)) return '--';
  return v >= 10000 ? fmtCompact(v) : v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : 4 });
};
