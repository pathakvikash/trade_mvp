import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import NotFound from './NotFound';

jest.mock('react-router-dom', () => ({ __esModule: true, Link: ({ to, children }) => <a href={to}>{children}</a> }), { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

test('NotFound links back to Dashboard and Trade', () => {
  const el = document.createElement('div');
  const root = createRoot(el);
  act(() => root.render(<NotFound />));
  expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/trade']);
  act(() => root.unmount());
});
