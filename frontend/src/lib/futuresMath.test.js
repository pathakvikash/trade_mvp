import { openQuote, closeQuote, addQuote, liqPrice, maxLeverage, unrealized, feeCents } from './futuresMath';


// Spec vectors V1-V5 (docs/phase2-leverage.md §3). Money in cents, liq in USD.
const v1 = () => openQuote('long', 1, 100, 10);
const v1Pos = { side: 'long', size: 1, entryPrice: 100, margin: 10, leverage: 10 };
const v4Pos = { side: 'long', size: 2, entryPrice: 110, margin: 22, leverage: 10 };

test('V1 long 1 @100 L10: notional, fee, margin, debit, liq', () => {
  const q = v1();
  expect(q.notional).toBe(10000);
  expect(q.fee).toBe(5);
  expect(q.margin).toBe(1000);
  expect(q.debit).toBe(1005);
  expect(q.liqPrice).toBeCloseTo(90 / 0.996, 8);
  expect(q.liqPrice).toBeCloseTo(90.36144578, 8);
});

test('V2 short 2 @100 L20: fee 10c, debit 1010, liq 105/1.004', () => {
  const q = openQuote('short', 2, 100, 20);
  expect(q.notional).toBe(20000);
  expect(q.fee).toBe(10);
  expect(q.debit).toBe(1010);
  expect(q.liqPrice).toBeCloseTo(105 / 1.004, 8);
  expect(q.liqPrice).toBeCloseTo(104.58167331, 8);
});

test('V3 close V1 fully @110: pnl 1000c, fee 6c, credit 1994c, net +989c vs start', () => {
  const c = closeQuote(v1Pos, 1, 110);
  expect(c).toEqual({ pnl: 1000, fee: 6, released: 1000, credit: 1994 });
  expect(c.credit - v1().debit).toBe(989);
});

test('V4 V1 + add 1 @120 L10: size 2, entry 110, margin 2200c, liq 99/0.996', () => {
  const a = addQuote(v1Pos, 1, 120);
  expect(a.size).toBe(2);
  expect(a.entryPrice).toBe(110);
  expect(a.margin).toBe(2200);
  expect(a.liqPrice).toBeCloseTo(99 / 0.996, 8);
  expect(a.liqPrice).toBeCloseTo(99.39759036, 8);
  expect(a.debit).toBe(1200 + 6); // new leg margin 1200c + fee ceil(12000*5/10000)=6c
});

test('V5 partial close V4 size 0.5 @110: released 550c, pnl 0, fee 3c, credit 547c, liq unchanged', () => {
  const c = closeQuote(v4Pos, 0.5, 110);
  expect(c).toEqual({ pnl: 0, fee: 3, released: 550, credit: 547 });
  // liq depends on margin/size, which a partial close preserves
  const left = { ...v4Pos, size: 1.5, margin: 22 - 5.5 };
  expect(liqPrice('long', 110, 1.5, left.margin, 0.004)).toBeCloseTo(liqPrice('long', 110, 2, 22, 0.004), 8);
});

test('fee has a 1 cent minimum and rounds up', () => {
  expect(feeCents(1)).toBe(1);
  expect(feeCents(10000)).toBe(5);
  expect(feeCents(11000)).toBe(6);
});

test('leverage caps: BTC 50x up to $50k, 20x above; alts 20x', () => {
  expect(maxLeverage('BTC', 50_000)).toBe(50);
  expect(maxLeverage('BTC', 50_001)).toBe(20);
  expect(maxLeverage('ETH', 1_000_000)).toBe(10);
  expect(maxLeverage('SOL', 10_000)).toBe(20);
  expect(maxLeverage('SOL', 10_000_000)).toBe(2);
});

test('liquidation sits between 0 and entry for long, above entry for short, at every leverage above 1x', () => {
  // 1x long liquidates at exactly 0 (margin equals notional), so the strict bound starts at 2x
  for (let lev = 2; lev <= 50; lev++) {
    const l = openQuote('long', 1, 100, lev).liqPrice;
    const s = openQuote('short', 1, 100, lev).liqPrice;
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(100);
    expect(s).toBeGreaterThan(100);
  }
});

test('unrealized pnl and ROE, long and short', () => {
  expect(unrealized({ side: 'long', size: 2, entryPrice: 100, margin: 20 }, 110)).toEqual({ pnl: 20, roe: 100 });
  expect(unrealized({ side: 'short', size: 2, entryPrice: 100, margin: 20 }, 110).pnl).toBe(-20);
});

const cfg = { tiers: [{ maxNotional: 1000, maxLev: 30, mmr: 0.01 }, { maxNotional: null, maxLev: 3, mmr: 0.1 }], symbolMaxLev: { BTC: 40 }, defaultMaxLev: 15, takerFeeRate: 0.001 };

test('config override: tiers (null = unbounded), symbol/default caps, fee rate', () => {
  expect(maxLeverage('BTC', 500, cfg)).toBe(30);
  expect(maxLeverage('BTC', 5_000_000, cfg)).toBe(3);
  expect(maxLeverage('SOL', 500, cfg)).toBe(15);
  expect(feeCents(10000, cfg)).toBe(10);
  const q = openQuote('long', 1, 2000, 2, cfg); // notional $2000 -> second tier mmr 0.1, fee 0.1% = 200c
  expect(q.mmr).toBe(0.1);
  expect(q.fee).toBe(200);
  expect(q.liqPrice).toBeCloseTo((2000 - 1000) / 0.9, 8);
  const a = addQuote({ side: 'long', size: 1, entryPrice: 100, margin: 10, leverage: 10 }, 1, 100, 10, cfg);
  expect(a.mmr).toBe(0.01);
  expect(a.fee).toBe(10);
});

test('no config keeps local defaults', () => {
  expect(maxLeverage('BTC', 50_000, undefined)).toBe(50);
  expect(openQuote('long', 1, 100, 10, undefined)).toEqual(openQuote('long', 1, 100, 10));
});

test('liqPrice clamps at 0 (over-margined long)', () => {
  expect(liqPrice('long', 100, 1, 150, 0.004)).toBe(0);
  expect(liqPrice('short', 100, 1, 150, 0.004)).toBeGreaterThan(100);
});
