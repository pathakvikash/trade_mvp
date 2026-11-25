import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { KeyLevels } from './LiqSide';

jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: () => ({ data: null, error: null }) }));

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const DATA = { price: 100, keyLevels: { above: [{ price: 110, usd: 5000, pct: 10 }], below: [{ price: 90, usd: 2000, pct: -10 }] } };

test('a key level chip opens details on click and still highlights its band on hover', () => {
  const onHighlight = jest.fn();
  act(() => root.render(<KeyLevels data={DATA} onHighlight={onHighlight} />));
  const chips = container.querySelectorAll('button[aria-haspopup="dialog"]');
  expect(chips).toHaveLength(2);
  expect(chips[0].textContent).toContain('110.00');
  act(() => { chips[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
  expect(onHighlight).toHaveBeenCalledWith(110);
  act(() => chips[0].click());
  const d = document.body.querySelector('[role="dialog"]').textContent;
  expect(d).toContain('110.00');
  expect(d).toContain('$5K');
  expect(d).toContain('Short liquidations (above price)');
  expect(d).toContain('+10.00%');
  expect(d).toContain('Model estimate');
  act(() => { chips[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); }); // a real press closes the first popover
  act(() => chips[1].click());
  expect(document.body.querySelector('[role="dialog"]').textContent).toContain('Long liquidations (below price)');
});
