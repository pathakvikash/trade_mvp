// Honest provenance text for data that did not come from Binance futures (X-Data-Source header).
// ctx: 'candles' (chart overlay), 'priceLine' (Derivatives), 'positioning', 'heatmap', 'oi'.
const NAME = { bybit: 'Bybit', bitget: 'Bitget', gate: 'Gate', mexc: 'MEXC' };
const NA = '(Binance futures history unavailable from this server)';

export function sourceNote(source, ctx = 'candles') {
  const n = NAME[source];
  if (source === 'spot') {
    if (ctx === 'priceLine') return 'Price line uses Binance spot candles (futures history unavailable from this server).';
    if (ctx === 'candles') return 'Spot candles (futures history unavailable from this server)';
    return '';
  }
  if (source === 'ws' && ctx === 'oi') return "Open interest is Bybit perpetuals open interest (Binance futures unavailable from this server); '--' = not listed on Bybit.";
  if (source === 'unavailable') {
    if (ctx === 'oi') return 'Open interest unavailable from this server';
    if (ctx === 'positioning') return 'Positioning data (open interest, long/short ratios) is unavailable from this server.';
    return '';
  }
  if (!n) return '';
  if (ctx === 'candles') return `Candles from ${n} perpetuals ${NA}`;
  if (ctx === 'priceLine') return `Price line uses ${n} perpetual candles ${NA.replace(/\)$/, ').')}`;
  if (ctx === 'positioning') return `Open interest, long/short ratio and funding are from ${n} (Binance futures unavailable from this server) and differ from Binance. Top-trader and taker series are not available.`;
  if (ctx === 'heatmap') return `Estimated from ${n} perpetuals data ${NA}. ${n} open interest and positions differ from Binance.`;
  return '';
}

export const PARTIAL_NOTE = 'History shorter than the selected range (new listing)';
