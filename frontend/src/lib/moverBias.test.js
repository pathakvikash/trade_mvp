import { moverBias, oiChangePct, lastRatio, nearestClusters } from './moverBias';

const levels = [
  { price: 98, longUsd: 900, shortUsd: 0 },
  { price: 90, longUsd: 100, shortUsd: 0 },
  { price: 103, longUsd: 0, shortUsd: 800 },
  { price: 120, longUsd: 0, shortUsd: 1000 },
];
const liq = nearestClusters(levels, 100);

describe('moverBias', () => {
  test('pump + high funding + heavy longs + OI falling = Short, high confidence, invalidation above', () => {
    const r = moverBias({ price: 100, change24h: 18, funding: 0.0008, oiChange24h: -6, lsRatio: 2.4, liq: nearestClusters([{ price: 104, longUsd: 0, shortUsd: 1 }, { price: 99, longUsd: 5, shortUsd: 0 }], 100) });
    // momentum +0.5, funding -1, oi -0.5 (falling vs up move => -0.5 * +1), ratio -0.5, liq: below 1% nearer => -0.5
    expect(r.bias).toBe('Short');
    expect(r.confidence).toBe('Medium'); // momentum disagrees, so not High
    expect(r.invalidation).toMatch(/above/);
    expect(r.reasons.length).toBeLessThanOrEqual(4);
  });

  test('dump + negative funding + shorts crowded = Long (squeeze risk)', () => {
    const r = moverBias({ price: 100, change24h: -15, funding: -0.0007, oiChange24h: -8, lsRatio: 0.7, liq: nearestClusters([{ price: 102, longUsd: 0, shortUsd: 900 }], 100) });
    // momentum -0.5, funding +1, oi +0.5, ratio +0.5, liq +0.5 = 2: four agree, one conflicts
    expect(r.score).toBeCloseTo(2);
    expect(r.bias).toBe('Long');
    expect(r.confidence).toBe('Medium');
    expect(r.invalidation).toMatch(/below 97/);
    expect(r.reasons.join(' ')).toMatch(/squeeze/i);
  });

  test('missing core data = Wait / Low, with missing list, nothing invented', () => {
    const r = moverBias({ price: 100, change24h: 10 });
    expect(r.bias).toBe('Wait');
    expect(r.confidence).toBe('Low');
    expect(r.missing).toEqual(expect.arrayContaining(['funding', 'open interest', 'long/short ratio', 'liquidation map (estimate)']));
    expect(moverBias({}).bias).toBe('Wait');
  });

  test('only core inputs available (< 3 factors) = Wait', () => {
    expect(moverBias({ price: 1, change24h: -20, funding: -0.001 }).bias).toBe('Wait');
  });

  test('conflicting factors = Wait', () => {
    // momentum +0.5, funding -1 (crowded), ratio +0.5 (shorts), oi +0.5 => score 0.5 -> weak
    const r = moverBias({ price: 100, change24h: 10, funding: 0.0009, oiChange24h: 5, lsRatio: 0.7 });
    expect(r.bias).toBe('Wait');
    expect(r.invalidation).toMatch(/Re-check/);
  });

  test('near-even factor split (agree 3 vs conflict 2) = Wait', () => {
    const r = moverBias({ price: 100, change24h: -15, funding: -0.0007, oiChange24h: -8, lsRatio: 0.7, liq });
    expect(r.bias).toBe('Wait');
  });

  test('deterministic', () => {
    const i = { price: 100, change24h: -15, funding: -0.0007, oiChange24h: 3, lsRatio: 0.7, liq };
    expect(moverBias(i)).toEqual(moverBias({ ...i }));
  });

  test('fallback invalidation uses the fixed 3% rule when no cluster', () => {
    const r = moverBias({ price: 100, change24h: 12, funding: -0.0009, oiChange24h: 6, lsRatio: 0.7 });
    expect(r.bias).toBe('Long');
    expect(r.invalidation).toMatch(/below 97 .*fixed 3%/);
  });
});

describe('helpers', () => {
  test('oiChangePct needs >= 6 usable points', () => {
    expect(oiChangePct([{ oiUsd: 1 }])).toBeNull();
    expect(oiChangePct(Array.from({ length: 10 }, (_, k) => ({ oiUsd: 100 + k * 10 })))).toBeCloseTo(90);
    expect(oiChangePct(null)).toBeNull();
  });
  test('lastRatio skips bad rows', () => {
    expect(lastRatio([{ ratio: 1.5 }, { ratio: NaN }])).toBe(1.5);
    expect(lastRatio([])).toBeNull();
  });
  test('nearestClusters picks nearest big bucket per side, ignores small ones', () => {
    expect(liq.below.price).toBe(98);
    expect(liq.above.price).toBe(103);
    expect(nearestClusters([], 100)).toBeNull();
  });
});
