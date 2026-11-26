import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import ModelCombobox from './ModelCombobox';

jest.mock('axios', () => ({ __esModule: true, default: {} }));

const MODELS = [
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', contextLength: 200000, pricePerMTokIn: 3, pricePerMTokOut: 15 },
  { id: 'meta/llama-free:free', name: 'Llama Free', contextLength: 8192, pricePerMTokIn: 0, pricePerMTokOut: 0, free: true },
  { id: 'plain-model', name: 'plain-model' },
];

let container;
let root;
let onChange;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
const mount = async (value = '') => {
  onChange = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ModelCombobox id="m" value={value} models={MODELS} onChange={onChange} />); });
};
afterEach(() => { act(() => root.unmount()); container.remove(); });
const input = () => container.querySelector('#m');
const focus = () => act(async () => { input().focus(); input().dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
const type = (v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), v);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});
const key = (k) => act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
const opts = () => [...container.querySelectorAll('[role="option"]')];

test('preselects the saved model: shown in the input, marked selected in the list', async () => {
  await mount('meta/llama-free:free');
  expect(input().value).toBe('meta/llama-free:free');
  expect(input().getAttribute('role')).toBe('combobox');
  await focus();
  expect(opts().find((o) => o.getAttribute('aria-selected') === 'true').textContent).toContain('Llama Free');
});

test('rows show name, id, context, price per 1M and a free tag', async () => {
  await mount();
  await focus();
  const [sonnet, llama, plain] = opts().map((o) => o.textContent);
  expect(sonnet).toContain('Claude Sonnet 5.5');
  expect(sonnet).toContain('anthropic/claude-sonnet-5.5');
  expect(sonnet).toContain('200K ctx');
  expect(sonnet).toContain('$3 in / $15 out per 1M tokens');
  expect(llama).toMatch(/free/i);
  expect(llama).not.toContain('per 1M');
  expect(plain).toBe('plain-model');
});

test('typing filters by id or name; clicking a row sets the model and closes the list', async () => {
  await mount();
  await focus();
  await type('LLAMA');
  expect(opts().map((o) => o.textContent)).toHaveLength(2); // match + custom row
  expect(opts()[0].textContent).toContain('Llama Free');
  await act(async () => { opts()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  expect(onChange).toHaveBeenCalledWith('meta/llama-free:free');
  expect(container.querySelector('[role="listbox"]')).toBeNull();
});

test('custom id: offered for an unknown valid id, chosen with the keyboard; invalid text is not offered', async () => {
  await mount();
  await focus();
  await type('my/own-model:1');
  expect(opts()).toHaveLength(1);
  expect(opts()[0].textContent).toBe('Use custom id my/own-model:1');
  await key('Enter');
  expect(onChange).toHaveBeenCalledWith('my/own-model:1');
  await focus();
  await type('bad id!');
  expect(opts()).toHaveLength(0);
  expect(container.textContent).toContain('No model matches');
});

test('arrow keys move the active row, Enter picks it, Escape closes without changing', async () => {
  await mount();
  await focus();
  await key('ArrowDown');
  expect(input().getAttribute('aria-activedescendant')).toBe(opts()[1].id);
  await key('Enter');
  expect(onChange).toHaveBeenCalledWith('meta/llama-free:free');
  await focus();
  await key('Escape');
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('a saved id that is not in the list gets a custom-id notice; a listed one does not', async () => {
  await mount('legacy/model');
  expect(container.querySelector('[role="status"]').textContent).toContain('legacy/model is not in the loaded list');
  act(() => root.unmount());
  container.remove();
  await mount('plain-model');
  expect(container.querySelector('[role="status"]')).toBeNull();
});
