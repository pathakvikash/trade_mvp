import { bandText, fmtDur, imbalanceLabel, liveStatus, scaleCells, statCards, validLayers, DEFAULT_LAYERS } from './obh';
import { drawObh, pointAt } from './obhDraw';
import { obhFixture } from './obhFixture';

test('fmtDur: how long a wall has stood', () => {
  expect(fmtDur(20e3)).toBe('<1m');
  expect(fmtDur(2 * 60e3 + 5)).toBe('2m');
  expect(fmtDur(65 * 60e3)).toBe('1h 5m');
  expect(fmtDur(120 * 60e3)).toBe('2h');
});

test('imbalance label', () => {
  expect(imbalanceLabel(12).text).toBe('bids heavier');
  expect(imbalanceLabel(-12).text).toBe('asks heavier');
  expect(imbalanceLabel(0.4).text).toBe('balanced');
  expect(imbalanceLabel(NaN).text).toBe('--');
});

test('bandText reports the band the snapshot really covers', () => {
  expect(bandText({ requestedPct: 1, bandPct: 1, partial: false })).toBe('within 1%');
  expect(bandText({ requestedPct: 1, bandPct: 0.4, partial: true })).toContain('within 0.4%');
});

test('statCards: six cards with distance, age, delta and honest band', () => {
  const cards = statCards(obhFixture(), 'BTC');
  expect(cards.map((c) => c.id)).toEqual(['last', 'bid', 'ask', 'imb', 'bidwall', 'askwall']);
  expect(cards[0].sub).toBe('Bid 101.5 · Ask 102.5');
  expect(cards[1].label).toBe('Bid depth within 1%');
  expect(cards[3].value).toBe('+20.0%');
  expect(cards[3].sub).toBe('bids heavier');
  expect(cards[3].foot).toBe('5 min ago -2.7%');
  expect(cards[4].foot).toBe('-1.16% from price · up 2m');
  expect(cards[5].value).toBe('--'); // no ask wall in the fixture
  expect(cards[5].sub).toContain('None at 10x');
  const partial = obhFixture({ depth: { ...obhFixture().depth, partial: true, bandPct: 0.4 }, imbalance: { pct: 1, prevPct: null, prevAgoMs: null } });
  const c2 = statCards(partial, 'BTC');
  expect(c2[1].label).toContain('within 0.4%');
  expect(c2[3].foot).toBe('No 5 min history yet');
});

test('scaleCells: size = USD / row price; usd passes through', () => {
  const d = obhFixture();
  expect(scaleCells(d, 'usd').cells).toBe(d.cells);
  const q = scaleCells(d, 'qty');
  expect(q.cells[2]).toBeCloseTo(500 / 102.5, 5); // col 0, row 2: bucket middle 100 + 2.5
  expect(q.max).toBeGreaterThan(0);
});

test('liveStatus and layer validation', () => {
  expect(liveStatus(obhFixture(), null).text).toBe('Live');
  expect(liveStatus({ status: 'ok', stale: true }, null).text).toBe('Stale');
  expect(liveStatus({ status: 'thin' }, null).text).toBe('Thin book');
  expect(liveStatus(null, { x: 1 }).text).toBe('Offline');
  expect(validLayers(DEFAULT_LAYERS)).toBe(true);
  expect(validLayers({ candles: 1 })).toBe(false);
});

test('drawObh paints heat cells above the colour range floor, tags, bubbles and candles; pointAt inverts the maps', () => {
  const d = obhFixture();
  const calls = { fillRect: 0, arc: 0, text: [] };
  const ctx = new Proxy({}, { get: (t, k) => (k === 'fillRect' ? () => { calls.fillRect += 1; } : k === 'arc' ? () => { calls.arc += 1; } : k === 'fillText' ? (s) => calls.text.push(s) : k === 'measureText' ? () => ({ width: 40 }) : () => {}), set: () => true });
  const base = { d, cells: d.cells, max: d.max, palette: 'viridis', range: [0, 100], view: { k: 1, ox: 0, oy: 0 }, layers: { candles: true, line: true, walls: true, trades: true }, candles: [{ time: d.t0 / 1000, open: 101, close: 102, high: 103, low: 100, volume: 5 }], ivMs: 60e3, sub: 'none' };
  drawObh(ctx, 600, 380, base);
  const nonEmpty = d.cells.filter((v) => v > 0).length;
  expect(calls.fillRect).toBeGreaterThanOrEqual(nonEmpty + 1); // cells + one candle body (+ tags)
  expect(calls.arc).toBe(d.trades.length);
  expect(calls.text.some((s) => s.startsWith('Bid wall'))).toBe(true);
  const first = calls.fillRect;
  Object.assign(calls, { fillRect: 0, arc: 0, text: [] });
  drawObh(ctx, 600, 380, { ...base, range: [50, 100], layers: { candles: false, line: false, walls: false, trades: false } });
  expect(calls.fillRect).toBeLessThan(first);
  expect(calls.arc).toBe(0);
  expect(calls.text.some((s) => s.startsWith('Bid wall'))).toBe(false);
  const p = pointAt(d, { k: 1, ox: 0, oy: 0 }, 0.5, 0.5);
  expect(p.inside).toBe(true);
  expect(p.col).toBe(Math.floor(d.cols / 2));
  expect(p.price).toBeCloseTo(d.priceMin + 0.5 * d.priceStep * d.rows, 5);
  expect(pointAt(d, { k: 2, ox: 0.5, oy: 0 }, 0, 0).t).toBeCloseTo(d.t0 + 0.5 * d.cols * d.colMs, 3);
});
