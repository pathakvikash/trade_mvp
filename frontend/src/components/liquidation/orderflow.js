import { API } from '../../lib/apiBase';

export const ORDERFLOW = `${API}/api/market/orderflow`;

// "Collecting data, 3 min so far": the collector only knows what it has seen since it started for this symbol.
export const collectingText = (ms) => {
  const m = Math.floor((ms || 0) / 60e3);
  return `Collecting data, ${m < 1 ? 'less than a minute' : `${m} min`} so far`;
};

// What the panel says for a failed or non-ok answer; null when there is data to show.
export function flowNotice(error, data) {
  const st = error?.response?.status;
  const body = error?.response?.data;
  if (st === 404) return 'This coin has no futures market, so there is no order flow to show.';
  if (st === 503 && body?.error === 'collector_busy') return 'Order flow is busy with other coins, try again in a minute.';
  if (error && !data) return 'Order book data is unavailable from this server right now.';
  return null;
}

export const THIN_TEXT = 'Thin book: too few orders or too wide a spread on this coin to draw a useful picture. It will appear when the book fills out.';
