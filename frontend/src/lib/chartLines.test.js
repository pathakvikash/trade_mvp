import { buildChartLines, spotEntryFromTrades, baseTicker } from './chartLines';

const longPos = {
  _id: 'p1', symbol: 'BTC', side: 'long', size: 0.5, entryPrice: 60000, leverage: 10, margin: 500,
  liqPrice: 54000, tp: null, sl: null, status: 'open',
};
const shortPos = {
  _id: 'p2', symbol: 'BTCUSDT', side: 'short', size: 2, entryPrice: 100, leverage: 5, margin: 200,
  liqPrice: 105, tp: 80, sl: 110, status: 'open',
};

const byKind = (lines, kind) => lines.find((l) => l.kind === kind);

test('long entry line carries P/L when mark is a positive number', () => {
  const lines = buildChartLines({ symbol: 'BTCUSDT', positions: [longPos], mark: 60100 });
  expect(byKind(lines, 'entry')).toEqual({
    id: 'entry:p1', price: 60000, title: 'Long 10x · 0.5 BTC · +$50.00 (+10.0%)',
    color: '#38bdf8', style: 'solid', kind: 'entry',
  });
});

test('liq line is a dashed rose line titled with the liq price', () => {
  const lines = buildChartLines({ symbol: 'BTC', positions: [longPos], mark: 60100 });
  expect(byKind(lines, 'liq')).toEqual({
    id: 'liq:p1', price: 54000, title: 'Liq 54,000.00', color: '#f43f5e', style: 'dashed', kind: 'liq',
  });
});

test('short entry shows P/L; tp and sl titles are estimated PnL at the trigger price', () => {
  const lines = buildChartLines({ symbol: 'BTC', positions: [shortPos], mark: 90 });
  expect(byKind(lines, 'entry').title).toBe('Short 5x · 2 BTC · +$20.00 (+10.0%)');
  expect(byKind(lines, 'tp')).toEqual({
    id: 'tp:p2', price: 80, title: 'TP +$40.00 est', color: '#10b981', style: 'dashed', kind: 'tp',
  });
  expect(byKind(lines, 'sl')).toEqual({
    id: 'sl:p2', price: 110, title: 'SL -$20.00 est', color: '#f59e0b', style: 'dashed', kind: 'sl',
  });
  expect(byKind(lines, 'liq').title).toBe('Liq 105.00');
});

test('tp and sl lines appear only when set', () => {
  const kinds = buildChartLines({ symbol: 'BTC', positions: [longPos], mark: 60100 }).map((l) => l.kind);
  expect(kinds).toEqual(['entry', 'liq']);
  const noLiq = buildChartLines({ symbol: 'BTC', positions: [{ ...longPos, liqPrice: null }] }).map((l) => l.kind);
  expect(noLiq).toEqual(['entry']);
});

test('no P/L text without a usable mark; tp/sl estimates do not need a mark', () => {
  [undefined, null, 0, -5, NaN, '60100'].forEach((mark) => {
    const lines = buildChartLines({ symbol: 'BTC', positions: [longPos], mark });
    expect(byKind(lines, 'entry').title).toBe('Long 10x · 0.5 BTC');
  });
  const lines = buildChartLines({ symbol: 'BTC', positions: [shortPos], mark: undefined });
  expect(byKind(lines, 'entry').title).toBe('Short 5x · 2 BTC');
  expect(byKind(lines, 'tp').title).toBe('TP +$40.00 est');
});

test('ignores other symbols and non-open positions', () => {
  const positions = [
    longPos,
    { ...longPos, _id: 'p3', symbol: 'ETHUSDT' },
    { ...longPos, _id: 'p4', status: 'closed' },
    { ...longPos, _id: 'p5', status: 'liquidated' },
  ];
  const ids = buildChartLines({ symbol: 'BTC', positions, mark: 60100 }).map((l) => l.id);
  expect(ids).toEqual(['entry:p1', 'liq:p1']);
});

test('symbol matching normalises BTC, BTCUSDT and lower case on both sides', () => {
  expect(baseTicker('btcusdt')).toBe('BTC');
  expect(baseTicker('BTC')).toBe('BTC');
  expect(buildChartLines({ symbol: 'btcusdt', positions: [shortPos] }).map((l) => l.kind)).toEqual(['entry', 'liq', 'tp', 'sl']);
  expect(buildChartLines({ symbol: 'BTC', positions: [longPos] }).length).toBe(2);
});

test('spot entry line with P/L vs mark, and none when spotEntry is null', () => {
  const lines = buildChartLines({
    symbol: 'BTC', spotEntry: { avgEntry: 60000, amount: 0.25 }, mark: 60720,
  });
  expect(lines).toEqual([{
    id: 'spot-entry', price: 60000, title: 'Spot entry · 0.25 BTC · +$180.00 (+1.2%)',
    color: '#38bdf8', style: 'solid', kind: 'entry',
  }]);
  const noMark = buildChartLines({ symbol: 'BTC', spotEntry: { avgEntry: 60000, amount: 0.25 } });
  expect(noMark[0].title).toBe('Spot entry · 0.25 BTC');
  expect(buildChartLines({ symbol: 'BTC', spotEntry: null, mark: 60720 })).toEqual([]);
});

test('only open limit orders for the symbol become violet order lines', () => {
  const futuresOrders = [
    { _id: 'o1', symbol: 'BTC', side: 'long', leverage: 10, size: 0.5, limitPrice: 59000, status: 'open' },
    { _id: 'o2', symbol: 'BTC', side: 'short', leverage: 10, size: 0.5, limitPrice: 61000, status: 'filled' },
    { _id: 'o3', symbol: 'ETHUSDT', side: 'long', leverage: 10, size: 1, limitPrice: 3000, status: 'open' },
  ];
  const spotOrders = [
    { _id: 's1', symbol: 'BTCUSDT', side: 'buy', amount: 0.5, limitPrice: 60000, status: 'open' },
    { _id: 's2', symbol: 'BTC', side: 'sell', amount: 0.1, limitPrice: 65000, status: 'cancelled' },
  ];
  const lines = buildChartLines({ symbol: 'BTC', futuresOrders, spotOrders });
  expect(lines).toEqual([
    {
      id: 'forder:o1', price: 59000, title: 'Limit long 10x 0.5 BTC @ 59,000.00',
      color: '#a78bfa', style: 'solid', kind: 'order',
    },
    {
      id: 'sorder:s1', price: 60000, title: 'Limit buy 0.5 @ 60,000.00',
      color: '#a78bfa', style: 'solid', kind: 'order',
    },
  ]);
});

test('spotEntryFromTrades: size-weighted buys, sells keep the average', () => {
  const d = new Date('2026-01-01');
  const trades = [
    { cryptoSymbol: 'BTC', type: 'buy', amount: 1, priceAtTrade: 100, date: d },
    { cryptoSymbol: 'BTC', type: 'buy', amount: 1, priceAtTrade: 200, date: d },
    { cryptoSymbol: 'BTC', type: 'sell', amount: 0.5, priceAtTrade: 300, date: d },
  ];
  expect(spotEntryFromTrades(trades, 'BTCUSDT')).toEqual({ avgEntry: 150, amount: 1.5 });
});

test('spotEntryFromTrades: full sell gives null; re-buy after that starts a new average', () => {
  const day = (n) => new Date(`2026-01-0${n}`);
  const sold = [
    { cryptoSymbol: 'BTC', type: 'buy', amount: 1, priceAtTrade: 100, date: day(1) },
    { cryptoSymbol: 'BTC', type: 'sell', amount: 1, priceAtTrade: 120, date: day(2) },
  ];
  expect(spotEntryFromTrades(sold, 'BTC')).toBeNull();
  const rebought = [...sold, { cryptoSymbol: 'BTC', type: 'buy', amount: 2, priceAtTrade: 50, date: day(3) }];
  expect(spotEntryFromTrades(rebought, 'BTC')).toEqual({ avgEntry: 50, amount: 2 });
});

test('spotEntryFromTrades: applies trades in date order, ignores other symbols and dust', () => {
  const day = (n) => new Date(`2026-01-0${n}`);
  // Listed newest first: sorted by date the buy comes before the sell, so the position is not empty.
  const unsorted = [
    { cryptoSymbol: 'BTC', type: 'sell', amount: 1, priceAtTrade: 120, date: day(2) },
    { cryptoSymbol: 'BTC', type: 'buy', amount: 1, priceAtTrade: 100, date: day(1) },
    { cryptoSymbol: 'ETH', type: 'buy', amount: 10, priceAtTrade: 1, date: day(1) },
  ];
  expect(spotEntryFromTrades(unsorted, 'BTCUSDT')).toBeNull();
  expect(spotEntryFromTrades([{ cryptoSymbol: 'BTC', type: 'buy', amount: 0.00000005, priceAtTrade: 1, date: day(1) }], 'BTC')).toBeNull();
  expect(spotEntryFromTrades([], 'BTC')).toBeNull();
});
