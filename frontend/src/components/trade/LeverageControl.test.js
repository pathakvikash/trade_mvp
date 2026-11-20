import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import LeverageControl from './LeverageControl';

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props) => act(() => {
  root.render(<LeverageControl value={10} max={50} onChange={jest.fn()} {...props} />);
});
const presets = () => [...container.querySelectorAll('[role="group"][aria-label="Leverage presets"] button')];
const slider = () => container.querySelector('input[type="range"]');
const preset = (label) => presets().find((b) => b.textContent === label);

test('presets are the fixed list filtered by max; slider spans 1..max', () => {
  render({ max: 20 });
  expect(presets().map((b) => b.textContent)).toEqual(['1x', '2x', '5x', '10x', '20x']);
  expect(slider().min).toBe('1');
  expect(slider().max).toBe('20');
  expect(slider().step).toBe('1');
});

test('value is marked pressed on its preset and announced on the slider', () => {
  render({ value: 10, max: 50 });
  expect(preset('10x').getAttribute('aria-pressed')).toBe('true');
  expect(preset('5x').getAttribute('aria-pressed')).toBe('false');
  expect(slider().value).toBe('10');
  expect(slider().getAttribute('aria-valuetext')).toBe('10x');
  expect(slider().getAttribute('aria-label')).toBe('Leverage');
});

test('clicking a preset calls onChange with that number', async () => {
  const onChange = jest.fn();
  render({ onChange });
  await act(async () => { preset('50x').click(); });
  expect(onChange).toHaveBeenCalledWith(50);
});

test('moving the slider calls onChange with a number', async () => {
  const onChange = jest.fn();
  render({ onChange, value: 10 });
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider(), '7');
    slider().dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(7);
});

test('value above max is clamped down via onChange and a note explains it', async () => {
  const onChange = jest.fn();
  render({ value: 50, max: 20, onChange });
  expect(onChange).toHaveBeenCalledWith(20);
  expect(container.textContent).toContain('Max 20x at this size');
  expect(slider().value).toBe('20');
});

test('no clamp call or note when value is within max', () => {
  const onChange = jest.fn();
  render({ value: 10, max: 20, onChange });
  expect(onChange).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('Max 20x at this size');
});

test('high leverage shows a warning, low leverage does not', () => {
  render({ value: 20, max: 50 });
  expect(container.textContent).toContain('High leverage');
  act(() => root.render(<LeverageControl value={5} max={50} onChange={jest.fn()} />));
  expect(container.textContent).not.toContain('High leverage');
});

test('shows liq price and required margin from props, or -- when missing', () => {
  render({ liqPrice: 90.36144578, requiredMargin: 1000 });
  expect(container.textContent).toContain('$90.3614');
  expect(container.textContent).toContain('$1,000.00');
  act(() => root.render(<LeverageControl value={1} max={50} onChange={jest.fn()} />));
  expect(container.textContent).toContain('--');
});

test('disabled disables presets and slider', () => {
  render({ disabled: true });
  expect(presets().every((b) => b.disabled)).toBe(true);
  expect(slider().disabled).toBe(true);
});

test('no "Leverage lowered" note while disabled', async () => {
  await render({ value: 50, max: 20, disabled: true });
  expect(container.textContent).not.toContain('Leverage lowered');
  await render({ value: 50, max: 20 });
  expect(container.textContent).toContain('Leverage lowered to 20x');
});
