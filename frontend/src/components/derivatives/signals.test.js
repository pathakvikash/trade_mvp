import { readouts } from './signals';

const oi = (a, b) => [{ ts: 1, oi: 1, oiUsd: a }, { ts: 2, oi: 1, oiUsd: b }];

test('no stats -> no read-outs', () => {
  expect(readouts(null)).toEqual([]);
  expect(readouts({})).toEqual([]);
});

test('positive funding with rising OI', () => {
  const r = readouts({ funding: [{ ts: 1, rate: 0.0003 }], openInterest: oi(100, 110) });
  expect(r[0]).toBe('Funding positive and OI rising: longs are paying and adding.');
});

test('negative funding with falling OI and price up', () => {
  const r = readouts({ funding: [{ ts: 1, rate: -0.0003 }], openInterest: oi(100, 90) }, [100, 105]);
  expect(r).toContain('Funding negative but OI falling: shorts are paying and covering.');
  expect(r).toContain('Price up while OI falls: the move looks like short covering, not new longs.');
});

test('ratios', () => {
  const r = readouts({ longShort: [{ ratio: 1.8 }], topLongShort: [{ ratio: 0.8 }], takerBuySell: [{ ratio: 0.8 }] });
  expect(r).toHaveLength(3);
  expect(r[1]).toMatch(/Top traders are net short/);
});
