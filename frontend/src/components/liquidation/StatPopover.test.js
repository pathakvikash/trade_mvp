import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import StatPopover from './StatPopover';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const dialog = () => document.body.querySelector('[role="dialog"]');

test('button toggles the popover', () => {
  act(() => root.render(<StatPopover label="Open interest" value="$1B">Explanation</StatPopover>));
  const btn = container.querySelector('button');
  expect(dialog()).toBeNull();
  act(() => btn.click());
  expect(dialog().textContent).toContain('Explanation');
  expect(btn.getAttribute('aria-expanded')).toBe('true');
  act(() => btn.click());
  expect(dialog()).toBeNull();
});

test('Escape and an outside press close it, a press inside does not', () => {
  act(() => root.render(<div><StatPopover label="L" value="1">Body</StatPopover><p id="out">outside</p></div>));
  act(() => container.querySelector('button').click());
  act(() => { dialog().dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(dialog()).not.toBeNull();
  act(() => { document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(dialog()).toBeNull();
  act(() => container.querySelector('button').click());
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(dialog()).toBeNull();
});

test('custom trigger and extra button props are used', () => {
  const onEnter = jest.fn();
  act(() => root.render(<StatPopover label="Row" trigger={<b>custom</b>} className="x" onMouseEnter={onEnter}>Body</StatPopover>));
  const btn = container.querySelector('button');
  expect(btn.textContent).toBe('custom');
  expect(btn.className).toBe('x');
  act(() => { btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
  expect(onEnter).toHaveBeenCalled();
});

const tab = (el, shiftKey = false) => { const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }); act(() => { el.dispatchEvent(e); }); return e; };

test('opening moves focus to the first item (or the container), closing returns it to the trigger', () => {
  act(() => root.render(<div><StatPopover label="A" value="1"><button type="button">first</button><button type="button">last</button></StatPopover><StatPopover label="B" value="2">plain text</StatPopover></div>));
  const [a, b] = container.querySelectorAll('button[aria-haspopup]');
  act(() => a.click());
  expect(document.activeElement.textContent).toBe('first');
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(a);
  act(() => b.click());
  expect(document.activeElement).toBe(dialog()); // no focusable item: the container takes focus
});

test('Tab past the last item (Shift+Tab before the first) closes and returns focus to the trigger', () => {
  act(() => root.render(<StatPopover label="A" value="1"><button type="button">first</button><button type="button">last</button></StatPopover>));
  const trigger = container.querySelector('button[aria-haspopup]');
  act(() => trigger.click());
  const [first, last] = dialog().querySelectorAll('button');
  act(() => last.focus());
  expect(tab(last).defaultPrevented).toBe(true);
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  act(() => trigger.click());
  expect(tab(dialog().querySelector('button'), true).defaultPrevented).toBe(true); // Shift+Tab on the first item
  expect(dialog()).toBeNull();
  expect(first).toBeTruthy();
});

test('focus leaving both the trigger and the popover closes it; moving between them does not', () => {
  act(() => root.render(<div><StatPopover label="A" value="1"><button type="button">item</button></StatPopover><input id="o" /></div>));
  const trigger = container.querySelector('button[aria-haspopup]');
  act(() => trigger.click());
  const item = dialog().querySelector('button');
  act(() => { item.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: trigger })); });
  expect(dialog()).not.toBeNull();
  act(() => { item.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: container.querySelector('#o') })); });
  expect(dialog()).toBeNull();
});
