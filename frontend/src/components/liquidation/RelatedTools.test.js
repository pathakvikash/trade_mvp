import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import RelatedTools from './RelatedTools';

global.IS_REACT_ACT_ENVIRONMENT = true;

test('six tool cards, only the existing ones are links', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<RelatedTools />));
  expect(container.querySelectorAll('li')).toHaveLength(6);
  // Max Pain, CVD, Order Book Heatmap and Large Orders are live: linked, no badge, no 'Not built yet' copy
  const live = [...container.querySelectorAll('li')].filter((li) => /Max Pain|CVD|Order Book Heatmap|Large Orders/.test(li.textContent));
  expect(live).toHaveLength(4);
  live.forEach((li) => { expect(li.querySelector('a')).not.toBeNull(); expect(li.textContent).not.toMatch(/Coming soon|Not built yet/); });
  act(() => root.unmount());
});

test('the live tools link to anchors that exist on the page', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<RelatedTools />));
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual(expect.arrayContaining(['#liq-map', '#liq-levels', '#liq-max-pain', '#liq-cvd', '#order-book-heatmap', '#large-orders']));
  act(() => root.unmount());
});
