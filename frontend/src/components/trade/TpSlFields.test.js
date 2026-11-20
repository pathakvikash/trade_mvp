import React, { useState } from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import TpSlFields, { tpSlErrors, toPrice } from './TpSlFields';

let container;
let root;
let last;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => localStorage.clear());
afterEach(() => { act(() => root.unmount()); container.remove(); });

const Wrap = ({ initial, ...props }) => {
  const [value, setValue] = useState(initial || { tp: null, sl: null });
  return <TpSlFields {...props} value={value} onChange={(v) => { last = v; setValue(v); }} />;
};
const mount = async (props) => {
  last = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Wrap refPrice={100} liqPrice={90} side="long" size={2} leverage={10} {...props} />); });
};
const $ = (sel) => container.querySelector(sel);
const setValue = (el, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const click = (el) => act(async () => { el.click(); });
const enable = () => click($('#tpsl-enable'));
const tab = (name) => [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name);

test('collapsed by default: no inputs; unchecking clears values', async () => {
  await mount();
  expect($('#tpsl-tp')).toBeNull();
  await enable();
  await setValue($('#tpsl-tp'), '110');
  expect(last).toEqual({ tp: 110, sl: null });
  await enable();
  expect(last).toEqual({ tp: null, sl: null });
  expect($('#tpsl-tp')).toBeNull();
});

test('long bounds: tp above ref, sl between liq and ref', () => {
  const b = (tp, sl) => tpSlErrors({ side: 'long', refPrice: 100, liqPrice: 90, tp, sl });
  expect(b(110, 95)).toBeNull();
  expect(b(100, 100).tp).toMatch(/above/);
  expect(b(null, 100).sl).toMatch(/below/);
  expect(b(null, 90).sl).toMatch(/liquidation/);
  expect(b(null, 80).sl).toMatch(/liquidation/);
  expect(b(95, null).tp).toMatch(/above/);
});

test('short bounds: tp below ref, sl between ref and liq', () => {
  const b = (tp, sl) => tpSlErrors({ side: 'short', refPrice: 100, liqPrice: 110, tp, sl });
  expect(b(90, 105)).toBeNull();
  expect(b(100, null).tp).toMatch(/below/);
  expect(b(null, 100).sl).toMatch(/above/);
  expect(b(null, 110).sl).toMatch(/liquidation/);
  expect(b(0, null).tp).toMatch(/above 0/);
});

test('invalid input shows an accessible inline error and aria-invalid', async () => {
  await mount();
  await enable();
  await setValue($('#tpsl-sl'), '85');
  expect($('#tpsl-sl').getAttribute('aria-invalid')).toBe('true');
  expect($('#tpsl-sl-err').getAttribute('role')).toBe('alert');
  expect($('#tpsl-sl').getAttribute('aria-describedby')).toBe('tpsl-sl-err');
  expect($('label[for="tpsl-sl"]')).not.toBeNull();
  expect(last.sl).toBe(85); // still emitted so the parent can gate submit with tpSlErrors
});

test('est. PnL and ROE at each trigger (long size 2, 10x)', async () => {
  await mount();
  await enable();
  await setValue($('#tpsl-tp'), '110');
  await setValue($('#tpsl-sl'), '95');
  expect($('#tpsl-tp-pnl').textContent).toMatch(/\+\$20\.00 \(\+100\.00% ROE\)/);
  expect($('#tpsl-sl-pnl').textContent).toMatch(/-\$10\.00 \(-50\.00% ROE\)/);
});

test('% ROE mode converts to prices on the right side for long and short', async () => {
  const ctx = (kind, side) => ({ kind, mode: 'roe', side, refPrice: 100, leverage: 10 });
  expect(toPrice('50', ctx('tp', 'long'))).toBe(105);
  expect(toPrice('50', ctx('sl', 'long'))).toBe(95);
  expect(toPrice('50', ctx('tp', 'short'))).toBe(95);
  expect(toPrice('50', ctx('sl', 'short'))).toBe(105);
  expect(toPrice('', ctx('tp', 'long'))).toBeNull();

  await mount();
  await enable();
  await click(tab('% ROE'));
  await setValue($('#tpsl-tp'), '50');
  expect(last.tp).toBe(105);
  expect($('#tpsl-tp-pnl').textContent).toMatch(/Price 105\.00/);
});

test('switching mode re-expresses the same price (price 105 -> 50% ROE and back)', async () => {
  await mount({ initial: { tp: 105, sl: null } });
  expect($('#tpsl-tp').value).toBe('105');
  await click(tab('% ROE'));
  expect($('#tpsl-tp').value).toBe('50');
  await click(tab('Price'));
  expect($('#tpsl-tp').value).toBe('105');
});

test('no reference price: inputs disabled with a hint', async () => {
  await mount({ refPrice: null, initial: { tp: null, sl: null } });
  await enable();
  expect($('#tpsl-tp').disabled).toBe(true);
  expect(container.textContent).toMatch(/Waiting for a reference price/);
});

test('external value reset clears the shown text (controlled)', async () => {
  await mount({ initial: { tp: 110, sl: null } });
  expect($('#tpsl-tp').value).toBe('110');
  await setValue($('#tpsl-tp'), '');
  expect(last).toEqual({ tp: null, sl: null });
  expect($('#tpsl-tp').value).toBe('');
});

test('adding to a position: est. PnL uses the new average entry, bounds keep the reference', async () => {
  // long 1 @60000 + add 0.1 @70000 -> avg entry ~60909.09, total size 1.1, fill ref 70000
  const entry = (60000 + 0.1 * 70000) / 1.1;
  await mount({ refPrice: 70000, entryPrice: entry, liqPrice: 50000, size: 1.1, leverage: 10 });
  await enable();
  await setValue($('#tpsl-tp'), '72000');
  expect($('#tpsl-tp-err')).toBeNull(); // 72000 > 70000 reference: valid
  const m = $('#tpsl-tp-pnl').textContent.match(/\+\$([\d,.]+)/)[1].replace(/,/g, '');
  expect(Number(m)).toBeCloseTo(1.1 * (72000 - entry), 0); // ~12,200, not 2,200
  expect(Number(m)).toBeGreaterThan(12000);
});
