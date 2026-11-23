import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import useMaximize from './useMaximize';

global.IS_REACT_ACT_ENVIRONMENT = true;
const hooks = [];
const Probe = ({ i }) => { hooks[i] = useMaximize(); return null; };
let root;
beforeEach(() => { root = createRoot(document.createElement('div')); act(() => root.render(<><Probe i={0} /><Probe i={1} /></>)); });
afterEach(() => { act(() => root.unmount()); document.documentElement.style.overflow = ''; });

test.each([[0, 1], [1, 0]])('two panels maximised, exiting %i then %i leaves <html> overflow restored', (a, b) => {
  act(() => hooks[0].toggle());
  act(() => hooks[1].toggle());
  expect(document.documentElement.style.overflow).toBe('hidden');
  act(() => hooks[a].toggle());
  expect(document.documentElement.style.overflow).toBe('hidden'); // the other is still maximised
  act(() => hooks[b].toggle());
  expect(document.documentElement.style.overflow).toBe('');
});
