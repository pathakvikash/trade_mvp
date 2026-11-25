import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import HeatHoverCard from './HeatHoverCard';
import { buildCursor } from './heat';

global.IS_REACT_ACT_ENVIRONMENT = true;

const D = () => {
  const d = { cols: 6, rows: 8, t0: 1700000000000, colMs: 300000, priceMin: 100, priceStep: 10, price: 145, cells: [], candles: [] };
  for (let c = 0; c < 6; c += 1) {
    d.candles.push({ open: 100, close: 101 + c });
    for (let r = 0; r < 8; r += 1) d.cells.push((c + 1) * 100 + r);
  }
  return d;
};
let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('renders nothing without a cursor', () => {
  act(() => root.render(<HeatHoverCard cursor={null} />));
  expect(container.innerHTML).toBe('');
});

test('shows the cell facts as a tooltip with honest estimate wording', () => {
  act(() => root.render(<HeatHoverCard cursor={buildCursor(D(), 2, 6)} anchor={{ x: 10, y: 10 }} id="c1" />));
  const tip = container.querySelector('[role="tooltip"]');
  expect(tip.id).toBe('c1');
  expect(tip.className).toContain('pointer-events-none');
  const t = tip.textContent;
  expect(t).toContain('Close 103');
  expect(t).toContain('+3.00%');
  expect(t).toContain('15 min before the latest');
  expect(t).toContain('5 min per column');
  expect(t).toContain('Price step 10');
  expect(t).toContain('±3 rows: shorts · longs');
  expect(t).toContain('From price');
  expect(t).toContain('Swept from the close to here');
  expect(t).toContain('Model estimates');
  expect(tip.querySelectorAll('[data-cell]')).toHaveLength(1);
  expect(tip.querySelector('[data-cell]').textContent).toBe('$306');
  expect(tip.querySelector('button')).toBeNull(); // no close button for a mouse hover
});

test('a touch card has a close button, and it is the only pointer target', () => {
  const onClose = jest.fn();
  act(() => root.render(<HeatHoverCard cursor={buildCursor(D(), 5, 0)} touch onClose={onClose} />));
  expect(container.textContent).toContain('Latest column');
  const b = container.querySelector('button[aria-label="Close cell details"]');
  expect(b.className).toContain('pointer-events-auto');
  act(() => b.click());
  expect(onClose).toHaveBeenCalled();
});

test('flips to the left of the pointer near the right edge and stays inside the viewport', () => {
  const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 280 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 });
  window.innerWidth = 400;
  window.innerHeight = 600;
  act(() => root.render(<HeatHoverCard cursor={buildCursor(D(), 2, 3)} anchor={{ x: 380, y: 590 }} />));
  const s = container.querySelector('[role="tooltip"]').style;
  expect(parseInt(s.left, 10)).toBeLessThanOrEqual(400 - 280 - 4 + 1);
  expect(parseInt(s.top, 10)).toBeLessThanOrEqual(600 - 300 - 4);
  expect(s.visibility).toBe('visible');
  if (orig) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', orig); else delete HTMLElement.prototype.offsetWidth;
  delete HTMLElement.prototype.offsetHeight;
});
