import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LegendFab from './LegendFab';
import { rampCss } from './heat';
import StatPopover from './StatPopover';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => { localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('legend button starts closed, opens a real legend and closes with the button and Escape', () => {
  act(() => root.render(<LegendFab max={1000} />));
  const btn = container.querySelector('button');
  expect(btn.getAttribute('aria-expanded')).toBe('false');
  act(() => btn.click());
  const region = container.querySelector('[role="region"]');
  expect(region.textContent).toContain('$0 (0%)');
  expect(region.textContent).toContain('$1K (100%)');
  expect(region.textContent).toContain('left half = longs');
  expect(region.textContent).toContain('sampled');
  act(() => container.querySelector('[aria-label="Close legend"]').click());
  expect(container.querySelector('[role="region"]')).toBeNull();
  act(() => btn.click());
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('[role="region"]')).toBeNull();
});

test('the scale follows the stored palette and sits under the AI dock', () => {
  localStorage.setItem('tm:v1:anon:liquidation.heatPalette', '"inferno"');
  act(() => root.render(<LegendFab max={500} />));
  act(() => container.querySelector('button').click());
  expect(container.querySelector('[data-testid="legend-ramp"]').getAttribute('data-palette')).toBe('inferno');
  expect(rampCss('inferno')).toContain('rgb(0,0,4)');
  expect(container.firstChild.className).toContain('z-30'); // AgentDock is z-50
});

test('Escape closes only the topmost open layer', () => {
  act(() => root.render(<div><LegendFab max={500} /><StatPopover label="Pop" value="1">Body</StatPopover></div>));
  const legend = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Legend');
  act(() => legend.click());
  act(() => container.querySelector('button[aria-haspopup="dialog"]').click()); // opened last = topmost
  const esc = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  esc();
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('[role="region"]')).not.toBeNull(); // the legend underneath stays
  esc();
  expect(container.querySelector('[role="region"]')).toBeNull();
});
