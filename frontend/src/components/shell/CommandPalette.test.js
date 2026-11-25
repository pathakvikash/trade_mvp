import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import CommandPalette, { resetPaletteCache } from './CommandPalette';
import useMarketStore from '../../store/marketStore';
import usePolling from '../../lib/usePolling';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }), { virtual: true });
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

const DATA = {
  '/symbols': ['BTCUSDT', 'ETHUSDT', 'HUMAUSDT', 'SKYAIUSDT'],
  '/overview': [{ symbol: 'BTCUSDT', lastPrice: 60000, quoteVolume: 900, priceChangePercent: 1.5 }, { symbol: 'ETHUSDT', lastPrice: 3000, quoteVolume: 800, priceChangePercent: -2 }],
  '/quotes': { rows: [{ symbol: 'RELIANCE', name: 'Reliance Industries', category: 'stock', price: 1234.5, changePct: 1, currency: 'INR' }, { symbol: 'GOLD', name: 'Gold', category: 'commodity', price: 2000, changePct: 0.5, currency: 'USD' }] },
};
let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear();
  resetPaletteCache();
  mockNavigate.mockClear();
  useMarketStore.setState({ marketData: [{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }] });
  usePolling.mockImplementation((url) => {
    const k = Object.keys(DATA).find((x) => url && url.includes(x));
    return { data: k ? DATA[k] : null, error: null, loading: false };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const open = () => act(() => { root.render(<CommandPalette onClose={jest.fn()} />); });
const input = () => container.querySelector('input');
const type = (v) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), v);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});
const key = (k, extra = {}) => act(() => { input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })); });
const options = () => [...container.querySelectorAll('[role=option]')].map((o) => o.querySelector('.font-medium').textContent);

test('empty query suggests volume leaders then pages', () => {
  open();
  expect(container.textContent).toContain('Suggested');
  expect(options().slice(0, 2)).toEqual(['BTC', 'ETH']);
  expect(options()).toContain('Dashboard');
});

test('a token outside the overview is found and shows -- price; Enter opens Trade', () => {
  open();
  type('huma');
  expect(options()[0]).toBe('HUMA');
  expect(container.querySelector('[role=option]').textContent).toContain('--');
  key('Enter');
  expect(mockNavigate).toHaveBeenCalledWith('/trade?symbol=HUMA');
});

test('live price and 24h show when the overview has the row', () => {
  open();
  type('btc');
  const t = container.querySelector('[role=option]').textContent;
  expect(t).toContain('60,000');
  expect(t).toContain('+1.50%');
});

test('instruments are findable and route to their page', () => {
  open();
  type('reliance');
  key('Enter');
  expect(mockNavigate).toHaveBeenCalledWith('/stocks?symbol=RELIANCE');
  type('gold');
  key('Enter');
  expect(mockNavigate).toHaveBeenLastCalledWith('/derivatives?instrument=GOLD&category=commodity');
});

test('Tab walks quick actions, Enter runs the focused one', () => {
  open();
  type('skyai');
  key('Tab');
  expect(input().getAttribute('aria-activedescendant')).toBe('pal-token-SKYAI-liq');
  key('Enter');
  expect(mockNavigate).toHaveBeenCalledWith('/liquidation?symbol=SKYAIUSDT');
});

test('Derivatives action stores the pair for that page', () => {
  open();
  type('huma');
  key('Tab'); key('Tab');
  key('Enter');
  expect(localStorage.getItem('tm:v1:anon:derivatives.symbol')).toBe('"HUMAUSDT"');
  expect(mockNavigate).toHaveBeenCalledWith('/derivatives');
});

test('picked tokens become recents (validated) and lead the suggestions next time', () => {
  open();
  type('skyai');
  key('Enter');
  expect(JSON.parse(localStorage.getItem('tm:v1:anon:palette.recent'))).toEqual([{ k: 'token', s: 'SKYAI' }]);
  act(() => root.unmount());
  localStorage.setItem('tm:v1:anon:palette.recent', '[{"k":"bad"}]');
  root = createRoot(container);
  open();
  expect(options()[0]).toBe('BTC'); // corrupt recents ignored
  act(() => root.unmount());
  localStorage.setItem('tm:v1:anon:palette.recent', '[{"k":"token","s":"SKYAI"}]');
  root = createRoot(container);
  open();
  expect(options()[0]).toBe('SKYAI');
});

test('no match says so politely', () => {
  open();
  type('qqqqzz');
  expect(container.textContent).toContain('Check the spelling');
  expect(container.querySelector('[role=status]').textContent).toBe('No matches');
});

test('a11y: combobox, listbox, options, activedescendant and a polite count', () => {
  open();
  type('et');
  expect(input().getAttribute('role')).toBe('combobox');
  expect(container.querySelector('[role=listbox]')).not.toBeNull();
  const first = container.querySelector('[role=option]');
  expect(input().getAttribute('aria-activedescendant')).toBe(first.id);
  const live = container.querySelector('[aria-live=polite]');
  expect(live.textContent).toMatch(/\d+ results?/);
  key('ArrowDown');
  expect(input().getAttribute('aria-activedescendant')).toBe(container.querySelectorAll('[role=option]')[1].id);
});

test('rendered results are capped at 30', () => {
  usePolling.mockImplementation((url) => ({ data: url.includes('/symbols') ? Array.from({ length: 100 }, (_, i) => `AB${i}USDT`) : null }));
  open();
  type('ab');
  expect(container.querySelectorAll('[role=option]').length).toBe(30);
  expect(container.textContent).toContain('Type to narrow');
});
