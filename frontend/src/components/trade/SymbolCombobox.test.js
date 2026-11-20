import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import SymbolCombobox from './SymbolCombobox';

const row = (symbol, lastPrice, priceChangePercent, quoteVolume) => ({ symbol, lastPrice, markPrice: lastPrice, priceChangePercent, quoteVolume });
const OVERVIEW = [row('BTCUSDT', 60000, 1.5, 5e9), row('ETHUSDT', 3000, -2.25, 2e9), row('SOLUSDT', 150, 0.5, 1e9)];

let container;
let root;
let onSelect;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  onSelect = jest.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<SymbolCombobox symbols={['BTC', 'ETH', 'SOL']} overview={OVERVIEW} value="BTC" onSelect={onSelect} />); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const input = () => container.querySelector('input[role="combobox"]');
const options = () => [...container.querySelectorAll('[role="option"]')];
const open = () => act(async () => { input().focus(); });
const type = (value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), value);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});
const key = (k) => act(async () => { input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

test('closed by default; opening lists tickers with last price and 24h change', async () => {
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(input().value).toBe('BTC');
  await open();
  expect(input().getAttribute('aria-expanded')).toBe('true');
  expect(options().map((o) => o.textContent)).toEqual(['BTC60,000.00+1.50%', 'ETH3,000.00-2.25%', 'SOL150.00+0.50%']);
});

test('typing filters case-insensitively; no hits shows "No match"', async () => {
  await open();
  await type('so');
  expect(options().map((o) => o.textContent.slice(0, 3))).toEqual(['SOL']);
  await type('zzz');
  expect(options()).toHaveLength(0);
  expect(container.textContent).toContain('No match');
});

test('arrow keys move the active option and Enter selects it', async () => {
  await open();
  expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
  await key('ArrowDown');
  await key('ArrowDown');
  expect(input().getAttribute('aria-activedescendant')).toBe(options()[2].id);
  await key('Enter');
  expect(onSelect).toHaveBeenCalledWith('SOL');
  expect(container.querySelector('[role="listbox"]')).toBeNull();
});

test('Escape closes without selecting; clicking an option selects it', async () => {
  await open();
  await key('Escape');
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => { input().click(); }); // still focused, so a click reopens it
  await act(async () => { options()[1].click(); });
  expect(onSelect).toHaveBeenCalledWith('ETH');
});
