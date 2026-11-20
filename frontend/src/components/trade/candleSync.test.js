import { needsFullReload, foldTick } from './candleSync';

test('old[500] -> [] -> new[500] reloads instead of updating', () => {
  let count = 0;
  const calls = [];
  [500, 0, 500].forEach((len) => {
    if (len === 0) { count = 0; return; }
    calls.push(needsFullReload(count, len) ? 'setData' : 'update');
    count = len;
  });
  expect(calls).toEqual(['setData', 'setData']);
});

test('single new candle updates; backfill or shrink reloads', () => {
  expect(needsFullReload(500, 501)).toBe(false);
  expect(needsFullReload(500, 500)).toBe(false);
  expect(needsFullReload(500, 503)).toBe(true);
  expect(needsFullReload(500, 499)).toBe(true);
});

describe('foldTick', () => {
  const base = [{ time: 0, open: 10, high: 12, low: 9, close: 11, volume: 5 }];
  const tick = (time, high, low, close) => ({ time, open: close, high, low, close, volume: 1 });

  test('folds a tick inside the last bucket: close follows, high/low widen, open kept', () => {
    const { candles, refetch } = foldTick(base, tick(120, 13, 8, 12.5), 300);
    expect(refetch).toBe(false);
    expect(candles).toHaveLength(1);
    expect(candles[0]).toMatchObject({ time: 0, open: 10, high: 13, low: 8, close: 12.5 });
    expect(base[0].close).toBe(11); // input not mutated
  });

  test('tick past the last candle end asks for a refetch', () => {
    expect(foldTick(base, tick(300, 11, 11, 11), 300).refetch).toBe(true);
  });

  test('stale tick and empty series are ignored', () => {
    expect(foldTick(base, tick(-60, 99, 1, 5), 300)).toEqual({ candles: base, refetch: false });
    expect(foldTick([], tick(0, 1, 1, 1), 300)).toEqual({ candles: [], refetch: false });
  });
});
