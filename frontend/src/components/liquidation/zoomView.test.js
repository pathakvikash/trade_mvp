import { FULL, MAX_K, clampView, fmtZoom, panBy, reveal, toFull, toView, zoomAt } from './zoomView';

test('zoom keeps the point under the pointer fixed', () => {
  let v = FULL;
  [[2, 0.3, 0.7], [1.5, 0.9, 0.1], [0.8, 0.5, 0.5]].forEach(([f, fx, fy]) => {
    const before = [toFull(v, v.ox, fx), toFull(v, v.oy, fy)];
    v = zoomAt(v, f, fx, fy);
    expect(toFull(v, v.ox, fx)).toBeCloseTo(before[0], 9);
    expect(toFull(v, v.oy, fy)).toBeCloseTo(before[1], 9);
  });
});

test('zoom clamps to 1x..20x and never leaves the range', () => {
  expect(zoomAt(FULL, 0.1).k).toBe(1);
  expect(zoomAt(FULL, 1000, 1, 1)).toEqual({ k: MAX_K, ox: 1 - 1 / MAX_K, oy: 1 - 1 / MAX_K });
  expect(zoomAt(FULL, 2, 0, 0)).toEqual({ k: 2, ox: 0, oy: 0 });
  expect(clampView({ k: NaN, ox: 5, oy: -1 })).toEqual(FULL);
  expect(clampView({ k: 4, ox: 5, oy: 5 }, 'x')).toEqual({ k: 4, ox: 0.75, oy: 0 }); // x only axes keep oy at 0
});

test('pan moves content with the drag and clamps at the edges; no pan at 1x', () => {
  const v = { k: 4, ox: 0.3, oy: 0.3 };
  expect(panBy(v, 0.5, 0).ox).toBeCloseTo(0.3 - 0.125, 9); // dragging right shows what is to the left
  expect(panBy(v, -10, 10)).toEqual({ k: 4, ox: 0.75, oy: 0 });
  expect(panBy(FULL, 0.5, 0.5)).toEqual(FULL);
});

test('pixel <-> price round trip through the view', () => {
  const v = zoomAt(zoomAt(FULL, 3, 0.4, 0.6), 2, 0.8, 0.2);
  [0, 0.25, 0.5, 1].forEach((f) => expect(toView(v, v.ox, toFull(v, v.ox, f))).toBeCloseTo(f, 9));
  // price 0.0025 +-: full range 0.0020..0.0030 at 10x shows a window 0.0001 wide
  const lo = 0.002;
  const span = 0.001;
  const w = zoomAt(FULL, 10, 0.5, 0.5);
  const p = lo + toFull(w, w.ox, 0.5) * span;
  expect(p).toBeCloseTo(0.0025, 9);
  expect(toView(w, w.ox, (p - lo) / span)).toBeCloseTo(0.5, 9);
});

test('reveal pans the least amount to bring a point into view', () => {
  const v = { k: 4, ox: 0.2, oy: 0.2 };
  expect(reveal(v, 0.3, 0.3)).toEqual(v);
  expect(reveal(v, 0.9, 0.2).ox).toBeCloseTo(0.65, 9);
  expect(reveal(v, 0.0, 0.2).ox).toBe(0);
});

test('fmtZoom', () => { expect(fmtZoom(1)).toBe('1x'); expect(fmtZoom(4.5)).toBe('4.5x'); expect(fmtZoom(20)).toBe('20x'); });
