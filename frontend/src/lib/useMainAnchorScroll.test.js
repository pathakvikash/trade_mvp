import React, { useRef } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import useMainAnchorScroll from './useMainAnchorScroll';

const fs = require('fs');
const path = require('path');

const Harness = () => {
  const ref = useRef(null);
  useMainAnchorScroll(ref, '/x');
  return (
    <main ref={ref}>
      <a href="#t">go</a>
      <div id="t" tabIndex={-1}>target</div>
    </main>
  );
};

test('hash link scrolls only the main container, not the window or scrollIntoView', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const scrollTo = (Element.prototype.scrollTo = jest.fn());
  const into = (Element.prototype.scrollIntoView = jest.fn());
  window.scrollTo = jest.fn();
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
  container.querySelector('a').dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(true);
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(into).not.toHaveBeenCalled();
  expect(window.scrollTo).not.toHaveBeenCalled();
  act(() => root.unmount());
  container.remove();
});

test('shell root clips instead of hiding (hidden stays programmatically scrollable)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../components/Layout.js'), 'utf8');
  expect(src).toContain('h-dvh overflow-clip');
  expect(src).not.toMatch(/h-dvh overflow-hidden/);
});
