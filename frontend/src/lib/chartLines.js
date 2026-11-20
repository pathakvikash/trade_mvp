import { unrealized } from './futuresMath';
import { fmtPrice, fmtQty, fmtPct } from '../components/ui/fmt';

// Price lines for one symbol on the chart: open futures positions (entry, liq, tp, sl), open limit orders and the
// spot average entry. Pure, no React. P/L text is display only (the server is authoritative for money).

export const LINE_COLORS = { entry: '#38bdf8', liq: '#f43f5e', tp: '#10b981', sl: '#f59e0b', order: '#a78bfa' };
const LINE_STYLE = { entry: 'solid', order: 'solid', liq: 'dashed', tp: 'dashed', sl: 'dashed' };

const EPS = 0.0000001;

// 'BTC', 'btc' and 'BTCUSDT' all become 'BTC'.
export const baseTicker = (s) => String(s ?? '').trim().toUpperCase().replace(/USDT$/, '');

const isPos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

// +$42.10 / -$20.00. Rounds to cents first so the price formatter never shows more than two decimals.
const money = (v) => {
  const r = Math.round(Math.abs(v) * 100) / 100;
  return `${v < 0 && r > 0 ? '-' : '+'}$${fmtPrice(r)}`;
};
const pnlText = (pnl, roe) => `${money(pnl)} (${fmtPct(roe, 1)})`;

export const buildChartLines = ({ symbol, positions = [], futuresOrders = [], spotOrders = [], spotEntry = null, mark } = {}) => {
  const base = baseTicker(symbol);
  const hasMark = isPos(mark);
  const lines = [];
  const add = (kind, id, price, title) => {
    if (isPos(price)) lines.push({ id, price, title, color: LINE_COLORS[kind], style: LINE_STYLE[kind], kind });
  };

  positions.forEach((p, i) => {
    if (p.status !== 'open' || baseTicker(p.symbol) !== base) return;
    const id = String(p._id ?? p.id ?? `pos${i}`);
    const pl = hasMark ? unrealized(p, mark) : null;
    const side = p.side === 'long' ? 'Long' : 'Short';
    add('entry', `entry:${id}`, p.entryPrice,
      `${side} ${p.leverage}x · ${fmtQty(p.size)} ${base}${pl ? ` · ${pnlText(pl.pnl, pl.roe)}` : ''}`);
    add('liq', `liq:${id}`, p.liqPrice, `Liq ${fmtPrice(p.liqPrice)}`);
    if (isPos(p.tp)) add('tp', `tp:${id}`, p.tp, `TP ${money(unrealized(p, p.tp).pnl)} est`);
    if (isPos(p.sl)) add('sl', `sl:${id}`, p.sl, `SL ${money(unrealized(p, p.sl).pnl)} est`);
  });

  if (spotEntry && isPos(spotEntry.amount) && isPos(spotEntry.avgEntry)) {
    const { avgEntry, amount } = spotEntry;
    const pl = hasMark ? { pnl: amount * (mark - avgEntry), roe: ((mark - avgEntry) / avgEntry) * 100 } : null;
    add('entry', 'spot-entry', avgEntry,
      `Spot entry · ${fmtQty(amount)} ${base}${pl ? ` · ${pnlText(pl.pnl, pl.roe)}` : ''}`);
  }

  futuresOrders.forEach((o, i) => {
    if (o.status !== 'open' || baseTicker(o.symbol) !== base) return;
    add('order', `forder:${String(o._id ?? o.id ?? i)}`, o.limitPrice,
      `Limit ${o.side} ${o.leverage}x ${fmtQty(o.size)} ${base} @ ${fmtPrice(o.limitPrice)}`);
  });

  spotOrders.forEach((o, i) => {
    if (o.status !== 'open' || baseTicker(o.symbol) !== base) return;
    add('order', `sorder:${String(o._id ?? o.id ?? i)}`, o.limitPrice,
      `Limit ${o.side} ${fmtQty(o.amount)} @ ${fmtPrice(o.limitPrice)}`);
  });

  return lines;
};

const tradeTime = (t) => {
  const v = new Date(t.date).getTime();
  return Number.isFinite(v) ? v : 0;
};

// Average cost of the net spot holding in `symbol`. Buys move the average (size-weighted); sells reduce the amount
// and leave the average unchanged; a fully sold position resets. Trades are applied in date order. Fees are ignored.
export const spotEntryFromTrades = (trades = [], symbol) => {
  const base = baseTicker(symbol);
  const mine = trades
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => baseTicker(t.cryptoSymbol) === base)
    .sort((a, b) => tradeTime(a.t) - tradeTime(b.t) || a.i - b.i);

  let amount = 0;
  let avgEntry = 0;
  for (const { t } of mine) {
    const qty = Number(t.amount);
    const price = Number(t.priceAtTrade);
    if (!(qty > 0) || !(price > 0)) continue;
    if (t.type === 'buy') {
      avgEntry = (amount * avgEntry + qty * price) / (amount + qty);
      amount += qty;
    } else if (t.type === 'sell') {
      amount = Math.max(0, amount - qty); // selling more than held clamps at zero
      if (amount <= EPS) {
        amount = 0;
        avgEntry = 0;
      }
    }
  }
  return amount > EPS ? { avgEntry, amount } : null;
};
