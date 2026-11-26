import describeSpec from './describeSpec';

test('plain-English entry/exit lines, and odd specs do not throw', () => {
  const lines = describeSpec({ direction: 'long', entry: { long: { all: [{ left: 'rsi', op: 'lt', right: 30 }] } }, exit: { long: { any: [{ left: 'rsi', op: 'gt', right: { ref: 'ema', mul: 1.1 } }] } }, risk: { maxBars: 20 } });
  expect(lines).toEqual(['Trades long only.', 'Enters long when rsi is below 30.', 'Exits long when rsi is above ema x 1.1.', 'Closes a trade after 20 candles at most.']);
  expect(describeSpec(null)).toEqual([]);
  expect(describeSpec({ entry: { long: 5 } })).toEqual([]);
});
