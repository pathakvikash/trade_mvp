global.IS_REACT_ACT_ENVIRONMENT = true;
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Skeleton, { LoadingBlock } from './Skeleton';
import Spinner, { Updating } from './Spinner';

let host;
let root;
const render = (el) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(el));
  return host;
};
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test('Skeleton is a pulsing, hidden-from-AT block that takes className', () => {
  const el = render(<Skeleton className="h-4 w-10" />).firstChild;
  expect(el.getAttribute('aria-hidden')).toBe('true');
  expect(el.className).toContain('motion-safe:animate-pulse');
  expect(el.className).toContain('h-4 w-10');
});

test('LoadingBlock shows visible Loading text over a pulsing block', () => {
  const el = render(<LoadingBlock height={120} />);
  expect(el.textContent).toBe('Loading…');
  expect(el.querySelector('.motion-safe\\:animate-pulse')).not.toBeNull();
});

test('Spinner is an aria-hidden spinning svg with the requested size', () => {
  const svg = render(<Spinner size={20} className="text-cyan-400" />).querySelector('svg');
  expect(svg.getAttribute('aria-hidden')).toBe('true');
  expect(svg.getAttribute('width')).toBe('20');
  expect(svg.getAttribute('class')).toContain('motion-safe:animate-spin');
});

test('Updating renders a chip only while showing', () => {
  expect(render(<Updating show={false} />).textContent).toBe('');
  act(() => root.unmount());
  host.remove();
  expect(render(<Updating show />).textContent).toBe('Updating…');
});
