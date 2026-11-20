const fm = require('../services/futuresMath');

describe('spec vectors V1-V5 (exact cents)', () => {
  test('V1 long size 1 @100 L10', () => {
    const q = fm.openQuote('long', 1, 100, 10);
    expect(q.notional).toBe(10000);
    expect(q.fee).toBe(5);
    expect(q.margin).toBe(1000);
    expect(q.debit).toBe(1005);
    expect(q.mmr).toBe(0.004);
    expect(q.liqPrice).toBe(90.36144578);
  });

  test('V2 short size 2 @100 L20', () => {
    const q = fm.openQuote('short', 2, 100, 20);
    expect(q.notional).toBe(20000);
    expect(q.fee).toBe(10);
    expect(q.margin).toBe(1000);
    expect(q.debit).toBe(1010);
    expect(q.liqPrice).toBe(104.58167331);
  });

  test('V3 close V1 full @110', () => {
    const pos = { side: 'long', size: 1, entryPrice: 100, margin: 10, leverage: 10 };
    const c = fm.closeQuote(pos, 1, 110);
    expect(c.pnl).toBe(1000);
    expect(c.fee).toBe(6);
    expect(c.released).toBe(1000);
    expect(c.credit).toBe(1994);
    // net vs start: paid 1005 at open, received 1994 at close
    expect(c.credit - 1005).toBe(989);
  });

  test('V4 V1 + add 1 @120 L10', () => {
    const pos = { side: 'long', size: 1, entryPrice: 100, margin: 10, leverage: 10, symbol: 'BTC' };
    const a = fm.addQuote(pos, 1, 120);
    expect(a.size).toBe(2);
    expect(a.entryPrice).toBe(110);
    expect(a.margin).toBe(2200);
    expect(a.mmr).toBe(0.004);
    expect(a.liqPrice).toBe(99.39759036);
    expect(a.fee).toBe(6);
    expect(a.debit).toBe(1206);
  });

  test('V5 partial close V4 size 0.5 @110, liq unchanged', () => {
    const pos = { side: 'long', size: 2, entryPrice: 110, margin: 22, leverage: 10, mmr: 0.004 };
    const c = fm.closeQuote(pos, 0.5, 110);
    expect(c.released).toBe(550);
    expect(c.pnl).toBe(0);
    expect(c.fee).toBe(3);
    expect(c.credit).toBe(547);
    const before = fm.liqPrice('long', 110, 2, 22, 0.004);
    const after = fm.liqPrice('long', 110, 1.5, 16.5, 0.004);
    expect(after).toBe(before);
  });
});

describe('tiers and leverage caps', () => {
  test('BTC 50x up to $50k, 20x above', () => {
    expect(fm.maxLeverage('BTC', 50000)).toBe(50);
    expect(fm.maxLeverage('BTC', 50001)).toBe(20);
  });

  test('alts default to 20x', () => {
    expect(fm.maxLeverage('SOL', 1000)).toBe(20);
    expect(fm.maxLeverage('SOL', 1000000)).toBe(10);
  });

  test('tier boundaries are inclusive on the upper bound', () => {
    expect(fm.tierOf(250000).mmr).toBe(0.005);
    expect(fm.tierOf(250000.01).mmr).toBe(0.01);
    expect(fm.tierOf(1e12).maxLev).toBe(2);
  });
});

describe('fees and margin', () => {
  test('fee minimum is 1 cent', () => {
    expect(fm.openQuote('long', 0.0001, 50, 1).fee).toBe(1);
  });

  test('margin is ceil(notional / leverage)', () => {
    expect(fm.openQuote('long', 1, 100, 3).margin).toBe(3334);
  });
});

describe('liquidation bounds at every allowed leverage', () => {
  const notionals = [100, 50000, 50001, 300000, 2000000, 10000000];
  for (const sym of ['BTC', 'SOL']) {
    for (const n of notionals) {
      test(`${sym} notional $${n}`, () => {
        const price = 100;
        const size = n / price;
        const maxLev = fm.maxLeverage(sym, n);
        for (let lev = 1; lev <= maxLev; lev++) {
          const long = fm.openQuote('long', size, price, lev).liqPrice;
          const short = fm.openQuote('short', size, price, lev).liqPrice;
          // 1x long is liquidated only at price 0
          if (lev === 1) expect(long).toBeGreaterThanOrEqual(0);
          else expect(long).toBeGreaterThan(0);
          expect(long).toBeLessThan(price);
          expect(short).toBeGreaterThan(price);
        }
      });
    }
  }
});

describe('closeQuote and unrealized', () => {
  test('short pnl sign', () => {
    const pos = { side: 'short', size: 2, entryPrice: 100, margin: 10, leverage: 20 };
    expect(fm.closeQuote(pos, 2, 90).pnl).toBe(2000);
    expect(fm.closeQuote(pos, 2, 110).pnl).toBe(-2000);
  });

  test('credit is floored at 0 when loss exceeds margin', () => {
    const pos = { side: 'long', size: 1, entryPrice: 100, margin: 10, leverage: 10 };
    expect(fm.closeQuote(pos, 1, 50).credit).toBe(0);
  });

  test('rejects out-of-range close size', () => {
    const pos = { side: 'long', size: 1, entryPrice: 100, margin: 10, leverage: 10 };
    expect(() => fm.closeQuote(pos, 0, 100)).toThrow(RangeError);
    expect(() => fm.closeQuote(pos, 1.5, 100)).toThrow(RangeError);
  });

  test('unrealized pnl and roe', () => {
    const long = { side: 'long', size: 1, entryPrice: 100, margin: 10 };
    expect(fm.unrealized(long, 110)).toEqual({ pnl: 10, roe: 100 });
    const short = { side: 'short', size: 1, entryPrice: 100, margin: 10 };
    expect(fm.unrealized(short, 110).pnl).toBe(-10);
  });
});
