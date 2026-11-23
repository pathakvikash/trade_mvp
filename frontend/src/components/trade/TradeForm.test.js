import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import TradeForm from './TradeForm';

let container;
let root;
let onSubmit;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => localStorage.clear());
beforeEach(async () => {
  onSubmit = jest.fn(async () => true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TradeForm coin={{ symbol: 'BTC', price: 100 }} symbols={['BTC', 'ETH']} overview={[]} onSymbol={() => {}} onSubmit={onSubmit} message={{ type: '', text: '' }} isSubmitting={false} balance={1000} />);
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const $ = (sel) => container.querySelector(sel);
const tab = (name) => [...container.querySelectorAll('[role="tab"]')].find((t) => t.textContent === name);
const setValue = (el, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const submitBtn = () => $('button[type="submit"]');

test('Market is the default: read-only market price, plain button label, no limit field', () => {
  expect(tab('Market').getAttribute('aria-selected')).toBe('true');
  expect($('#order-limit')).toBeNull();
  expect($('#order-price').disabled).toBe(true);
  expect(submitBtn().textContent).toBe('Buy BTC');
});

test('switching to Limit prefills the last price, relabels the button and prices the total at the limit', async () => {
  await act(async () => { tab('Limit').click(); });
  expect($('#order-limit').value).toBe('100');
  expect(submitBtn().textContent).toBe('Place limit buy BTC');
  await setValue($('#order-amount'), '2');
  await setValue($('#order-limit'), '50');
  expect(container.textContent).toContain('$100.00'); // 2 x 50, not 2 x 100
});

test('limit price must be > 0: error shown and submit disabled', async () => {
  await act(async () => { tab('Limit').click(); });
  await setValue($('#order-amount'), '1');
  expect(submitBtn().disabled).toBe(false);
  await setValue($('#order-limit'), '0');
  expect(container.textContent).toContain('Limit price must be greater than 0');
  expect(submitBtn().disabled).toBe(true);
});

test('submit sends orderType and limitPrice only for limit orders', async () => {
  await setValue($('#order-amount'), '1');
  await act(async () => { $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(onSubmit).toHaveBeenLastCalledWith({ type: 'buy', amount: '1', orderType: 'market' });
  await act(async () => { tab('Limit').click(); });
  await setValue($('#order-amount'), '1');
  await setValue($('#order-limit'), '90');
  await act(async () => { $('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(onSubmit).toHaveBeenLastCalledWith({ type: 'buy', amount: '1', orderType: 'limit', limitPrice: '90' });
});

test('submit bar is in normal flow below xl (never covers Price / Estimated total); one Buy/Sell control set', () => {
  const bar = submitBtn().parentElement;
  expect(bar.className).not.toMatch(/(^|\s)sticky(\s|$)/);
  expect(bar.className).toContain('xl:sticky');
  expect([...container.querySelectorAll('[aria-label="Side"] button')].map((b) => b.textContent)).toEqual(['Buy', 'Sell']);
  expect([...container.querySelectorAll('button')].filter((b) => /^(Buy|Sell)\b/.test(b.textContent.trim()) && b.type === 'submit')).toHaveLength(1);
});
