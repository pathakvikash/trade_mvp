import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import Panel from './Panel';

global.IS_REACT_ACT_ENVIRONMENT = true;

const bodyOf = (props) => {
  const c = document.createElement('div');
  const root = createRoot(c);
  act(() => root.render(<Panel {...props}>x</Panel>));
  const el = c.querySelector('section > div:last-child');
  act(() => root.unmount());
  return el.className;
};

test('default body flexes from 0 (fills the panel)', () => {
  expect(bodyOf({})).toContain('flex-1');
});

test('explicit body height keeps its basis: no flex-1, never shrinks, still grows when maximised', () => {
  const cls = bodyOf({ bodyClassName: 'relative h-[340px] min-h-[340px] p-1.5' });
  expect(cls).not.toMatch(/(^|\s)flex-1(\s|$)/);
  expect(cls).toContain('shrink-0');
  expect(cls).toContain('basis-auto');
  expect(cls).toContain('grow');
});

test('min-h-[..] alone is not an explicit height', () => {
  expect(bodyOf({ bodyClassName: 'min-h-[320px] p-0' })).toContain('flex-1');
});
