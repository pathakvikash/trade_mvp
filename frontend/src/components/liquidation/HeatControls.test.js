import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import HeatControls from './HeatControls';

global.IS_REACT_ACT_ENVIRONMENT = true;

const setup = (over = {}) => {
  const p = { lens: 'heat', onLens: jest.fn(), palette: 'viridis', onPalette: jest.fn(), intensity: [10, 90], onIntensity: jest.fn(), max: 1000, display: { candles: true, grid: true, keyLevels: false, priceLine: true }, onDisplay: jest.fn(), ...over };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<HeatControls {...p} />));
  return { p, container, done: () => { act(() => root.unmount()); container.remove(); } };
};
const change = (el, value) => act(() => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});

test('lens offers Heat, Long only and Short only and reports the pick', () => {
  const { p, container, done } = setup();
  const sel = container.querySelectorAll('select')[0];
  expect([...sel.options].map((o) => o.textContent)).toEqual(['Heat', 'Long only', 'Short only']);
  change(sel, 'long');
  expect(p.onLens).toHaveBeenCalledWith('long');
  done();
});

test('colours has three palettes', () => {
  const { p, container, done } = setup();
  const sel = container.querySelectorAll('select')[1];
  expect(sel.options).toHaveLength(3);
  change(sel, 'inferno');
  expect(p.onPalette).toHaveBeenCalledWith('inferno');
  done();
});

test('intensity is two range inputs with a readout, and the handles cannot cross', () => {
  const { p, container, done } = setup();
  const [a, b] = container.querySelectorAll('input[type="range"]');
  expect(a.getAttribute('aria-label')).toMatch(/minimum/);
  expect(container.querySelector('[data-testid="intensity-readout"]').textContent).toBe('≥ 10% · $100 — ≤ 90% · $900');
  change(a, '95');
  expect(p.onIntensity).toHaveBeenLastCalledWith([89, 90]);
  change(b, '5');
  expect(p.onIntensity).toHaveBeenLastCalledWith([10, 11]);
  done();
});

test('display menu toggles items and closes on Escape', () => {
  const { p, container, done } = setup();
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Display');
  act(() => btn.click());
  const menu = document.querySelector('[role="group"][aria-label="Display"]');
  // portalled + fixed: no overflow ancestor can clip it; z-40 is above the heatmap and below the AgentDock (z-50)
  expect(container.contains(menu)).toBe(false);
  expect(menu.className).toMatch(/\bfixed\b/);
  expect(menu.className).toContain('z-40');
  expect(menu.style.visibility).toBe('visible');
  expect(document.activeElement).toBe(menu.querySelector('input'));
  const boxes = menu.querySelectorAll('input[type="checkbox"]');
  expect(boxes).toHaveLength(4);
  act(() => boxes[2].click());
  expect(p.onDisplay).toHaveBeenCalledWith({ candles: true, grid: true, keyLevels: true, priceLine: true });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.querySelector('[role="group"][aria-label="Display"]')).toBeNull();
  expect(document.activeElement).toBe(btn);
  done();
});
