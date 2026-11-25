import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LayoutMenu from './LayoutMenu';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let onChange;
const setup = () => {
  onChange = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<LayoutMenu value="single" onChange={onChange} />));
};
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const button = () => container.querySelector('button[aria-haspopup="menu"]');
const items = () => [...document.querySelectorAll('[role="menuitemradio"]')];
const open = () => act(() => button().click());
const key = (k, target = document.activeElement) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

test('renders closed with aria attributes, then opens as a menu with 4 radio items', () => {
  setup();
  expect(button().getAttribute('aria-haspopup')).toBe('menu');
  expect(button().getAttribute('aria-expanded')).toBe('false');
  expect(button().textContent).toContain('Single chart');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  open();
  expect(button().getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(items()).toHaveLength(4);
  expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
  expect(items().filter((i) => i.getAttribute('aria-disabled') === 'true')).toHaveLength(3);
  expect(document.body.textContent.match(/Coming soon/g)).toHaveLength(3);
  expect(container.textContent).not.toContain('Prime');
});

test('disabled items never fire onChange on click, Enter or Space', () => {
  setup();
  open();
  items().slice(1).forEach((i) => {
    act(() => i.click());
    i.focus();
    key('Enter');
    key(' ');
  });
  expect(onChange).not.toHaveBeenCalled();
  expect(button().getAttribute('aria-expanded')).toBe('true');
});

test('single chart fires onChange once and closes, returning focus to the button', () => {
  setup();
  open();
  act(() => items()[0].click());
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith('single');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(button());
});

test('roving focus: opens on checked item; Arrow/Home/End move through all items including disabled', () => {
  setup();
  open();
  expect(document.activeElement).toBe(items()[0]);
  key('ArrowDown');
  expect(document.activeElement).toBe(items()[1]);
  key('End');
  expect(document.activeElement).toBe(items()[3]);
  key('ArrowDown');
  expect(document.activeElement).toBe(items()[0]);
  key('ArrowUp');
  expect(document.activeElement).toBe(items()[3]);
  key('Home');
  expect(document.activeElement).toBe(items()[0]);
});

test('Escape closes and refocuses the button; Tab closes', () => {
  setup();
  open();
  key('Escape');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(button());
  open();
  key('Tab');
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test('outside click closes; inside click on a disabled item does not', () => {
  setup();
  open();
  act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test('menu is portalled to body with fixed positioning above the page and below the dock (z-40)', () => {
  setup();
  open();
  const m = document.querySelector('[role="menu"]');
  expect(container.contains(m)).toBe(false);
  expect(m.parentElement).toBe(document.body);
  expect(m.className).toMatch(/\bfixed\b/);
  expect(m.className).toContain('z-40');
  expect(m.style.visibility).toBe('visible');
});
