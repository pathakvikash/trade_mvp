import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Summary from './Summary';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const DATA = { windows: { '1h': { longUsd: 300, shortUsd: 100, count: 4 }, '4h': { longUsd: 0, shortUsd: 0, count: 0 }, '24h': { longUsd: 1000, shortUsd: 3000, count: 9 } } };

test('each rekt card still shows its numbers and clicking its header opens the details popover', () => {
  act(() => root.render(<Summary data={DATA} error={null} />));
  expect(container.textContent).toContain('Long $300');
  expect(container.textContent).toContain('4 events');
  const first = container.querySelector('button[aria-haspopup="dialog"]');
  expect(first.textContent).toContain('1h');
  act(() => first.click());
  const d = document.body.querySelector('[role="dialog"]').textContent;
  expect(d).toContain('Last 1h');
  expect(d).toContain('Longs $300 (75%)');
  expect(d).toContain('Shorts $100 (25%)');
  expect(d).toContain('4 events');
  expect(d).toContain('Sampled');
  expect(document.body.querySelector('[role="dialog"] [role="img"]')).not.toBeNull(); // share bar
});

test('an empty window does not divide by zero', () => {
  act(() => root.render(<Summary data={DATA} error={null} />));
  act(() => container.querySelectorAll('button[aria-haspopup="dialog"]')[1].click());
  expect(document.body.querySelector('[role="dialog"]').textContent).toContain('Longs $0 (0%)');
});

test('a failed refresh keeps the last numbers and says the refresh failed', () => {
  act(() => root.render(<Summary data={DATA} error={new Error('x')} />));
  expect(container.textContent).toContain('Long $300');
  expect(container.querySelector('[role="status"]').textContent).toContain('refresh failed');
  act(() => root.render(<Summary data={DATA} error={null} />));
  expect(container.querySelector('[role="status"]')).toBeNull();
});
