import { maxPain } from './maxPainCalc';

const lv = (price, usd) => ({ price, usd });
test('keeps the 3 largest per side, listed highest price first', () => {
  const r = maxPain({
    price: 100, largest: { price: 90, usd: 900, side: 'long' }, totals: { longUsd: 5, shortUsd: 6 },
    keyLevels: {
      above: [lv(105, 10), lv(110, 50), lv(120, 30), lv(115, 5), lv(130, 40)],
      below: [lv(95, 1), lv(90, 70), lv(80, 20), lv(85, 60), lv(70, 2)],
    },
  });
  expect(r.above.map((x) => x.price)).toEqual([130, 120, 110]); // usd 40, 30, 50 are the top 3
  expect(r.below.map((x) => x.price)).toEqual([90, 85, 80]);
  expect(r.pct).toBeCloseTo(-10, 6);
  expect(r.longUsd).toBe(5);
});

test('null without a positive largest bucket or price; fewer than 3 levels pass through', () => {
  expect(maxPain({ price: 100, largest: { price: 90, usd: 0 } })).toBeNull();
  expect(maxPain({ price: 0, largest: { price: 90, usd: 5 } })).toBeNull();
  const r = maxPain({ price: 100, largest: { price: 90, usd: 5, side: 'long' }, keyLevels: { above: [lv(101, 1), lv(102, 2)] } });
  expect(r.above.map((x) => x.price)).toEqual([102, 101]);
  expect(r.below).toEqual([]);
});

import { bubblesOf, confluence, layoutBubbles, levelsOf, summarize, tableRow } from './maxPainCalc';

const row = (symbol, below, above, extra = {}) => ({ symbol, below, above, longUsd: 1, shortUsd: 1, ...extra });
const L = (pct, usd, sigma = 1) => ({ price: 100 + pct, pct, usd, sigma });

test('summarize: pull, critical, strongest, squeeze', () => {
  const s = summarize([
    row('AUSDT', L(-0.5, 100), L(5, 40)),
    row('BUSDT', L(-10, 10), L(1.5, 300)),
    row('CUSDT', null, L(0.8, 50)),
  ]);
  expect(s.criticalCount).toBe(2); // A long and C short
  expect(s.strongest).toMatchObject({ symbol: 'BUSDT', side: 'short' });
  expect(s.squeezeCount).toBe(0); // B's long is 10% away
  expect(summarize([row('X', L(-1.5, 5), L(1.9, 5))]).squeezeCount).toBe(1);
  expect(s.belowPct).toBeGreaterThan(0);
  expect(summarize([]).belowPct).toBeNull();
});

test('bubblesOf toggles, critical-only and sigma axis', () => {
  const rows = [row('A', L(-0.5, 1, 0.4), L(4, 2, 2)), row('B', L(-3, 1, null), null)];
  expect(bubblesOf(rows).items).toHaveLength(3);
  expect(bubblesOf(rows, { long: false }).items.map((i) => i.key)).toEqual(['A:short']);
  expect(bubblesOf(rows, { criticalOnly: true }).items.map((i) => i.key)).toEqual(['A:long']);
  const sg = bubblesOf(rows, { axis: 'sigma' });
  expect(sg.noSigma).toBe(1);
  expect(sg.items.find((i) => i.key === 'A:long').x).toBeCloseTo(-0.4);
});

test('layoutBubbles is deterministic and never overlaps when there is room', () => {
  const items = Array.from({ length: 4 }, (_, i) => ({ key: `k${i}`, symbol: `S${i}`, x: 0.1 * (i % 3), usd: 100 + i * 10 }));
  const a = layoutBubbles(items, { width: 900, height: 320 });
  const b = layoutBubbles([...items].reverse(), { width: 900, height: 320 });
  expect(a.nodes.map((n) => [n.key, n.cx, n.cy])).toEqual(b.nodes.map((n) => [n.key, n.cx, n.cy]));
  for (let i = 0; i < a.nodes.length; i++) for (let j = i + 1; j < a.nodes.length; j++) {
    const p = a.nodes[i]; const q = a.nodes[j];
    expect(Math.hypot(p.cx - q.cx, p.cy - q.cy)).toBeGreaterThanOrEqual(p.r + q.r);
  }
});

test('levelsOf picks the strongest per side; confluence counts windows within 1%', () => {
  const lv = levelsOf({ keyLevels: { above: [{ price: 101, usd: 1, pct: 1 }, { price: 105, usd: 9, pct: 5 }], below: [] } });
  expect(lv.above.price).toBe(105);
  expect(lv.below).toBeNull();
  const by = { '24h': { above: { price: 105 } }, '3d': { above: { price: 105.5 } }, '1w': { above: { price: 120 } }, '12h': null };
  expect(confluence(by, '24h', 'above')).toEqual({ count: 2, total: 3 });
  expect(confluence(by, '24h', 'below')).toEqual({ count: 0, total: 0 });
});

test('tableRow flattens a coin and takes the nearest sigma', () => {
  const t = tableRow(row('A', L(-2, 5, 3), L(1, 7, 0.5)));
  expect(t).toMatchObject({ longPct: -2, shortPct: 1, usd: 12, sigma: 0.5 });
});
