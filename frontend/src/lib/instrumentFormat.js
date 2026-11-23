import React from 'react';

// Shared by pages/Stocks.js and the Derivatives "Real markets" panel (Yahoo-sourced, view only).
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
const NUM = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const VOL = new Intl.NumberFormat('en-IN');
const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });

export const inr = (n) => (Number.isFinite(n) ? INR.format(n) : '-');
export const asOf = (ms) => (Number.isFinite(ms) ? `${IST.format(new Date(ms))} IST` : '-');
export const volume = (n) => (Number.isFinite(n) ? VOL.format(n) : '-');
export const pct = (n) => (Number.isFinite(n) ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '-');

// Per-category price (trailing zeros trimmed, like fmtMarketPrice): index = plain points, currency pair = rate (4 decimals for EUR/USD), else money with the row's currency.
export function price(row, n) {
  if (!Number.isFinite(n)) return '-';
  if (row.category === 'index') return NUM.format(n);
  if (row.category === 'currency') return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: row.symbol === 'EURUSD' ? 4 : 2 });
  return row.currency === 'USD' ? USD.format(n) : inr(n);
}

export const Badge = ({ tone, children }) => (
  <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{children}</span>
);

// Open / Closed / n/a (marketOpen null) plus 'Delayed data' when stale.
export const StatusBadges = ({ row }) => (
  <span className="flex flex-wrap gap-1">
    <Badge tone={row.marketOpen ? 'border-emerald-400/40 text-emerald-300' : 'border-slate-600 text-slate-400'}>
      {row.marketOpen === true ? 'Open' : row.marketOpen === false ? 'Closed' : 'n/a'}
    </Badge>
    {row.stale && <Badge tone="border-amber-400/40 text-amber-300">Delayed data</Badge>}
  </span>
);
