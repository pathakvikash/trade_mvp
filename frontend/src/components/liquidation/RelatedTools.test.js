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
  expect(container.querySelectorAll('a')).toHaveLength(2);
  expect(container.textContent).toContain('Coming soon');
  act(() => root.unmount());
});

test('the two real tools link to anchors that exist on the page', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<RelatedTools />));
  expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#liq-map', '#liq-levels']);
  act(() => root.unmount());
});
