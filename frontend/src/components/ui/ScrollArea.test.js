import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import ScrollArea from './ScrollArea';

global.IS_REACT_ACT_ENVIRONMENT = true;

const Rows = ({ ids }) => (
  <table><thead className="sticky top-0"><tr><th>H</th></tr></thead><tbody>{ids.map((i) => <tr key={i}><td>{i}</td></tr>)}</tbody></table>
);
let container; let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const show = (ids, footer) => act(() => root.render(<ScrollArea label="Things" footer={footer}><Rows ids={ids} /></ScrollArea>));

test('is a focusable labelled region with sticky header and non-trapping overscroll', () => {
  show([1, 2], 'Showing 2');
  const r = container.querySelector('[role=region]');
  expect(r.getAttribute('aria-label')).toBe('Things');
  expect(r.getAttribute('tabindex')).toBe('0');
  expect(r.style.overscrollBehaviorY).toBe('auto');
  expect(r.className).toContain('focus-ring');
  expect(r.querySelector('thead').className).toContain('sticky');
  expect(container.textContent).toContain('Showing 2');
});

test('a poll that prepends rows keeps the same scroller and scrollTop', () => {
  show([1, 2, 3]);
  const r = container.querySelector('[role=region]');
  r.scrollTop = 40;
  show([0, 1, 2, 3]);
  expect(container.querySelector('[role=region]')).toBe(r);
  expect(r.scrollTop).toBe(40);
});
