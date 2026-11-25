import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import HomeStats, { pulseOf } from './HomeStats';
import usePolling from '../../lib/usePolling';

jest.mock('react-router-dom', () => ({ __esModule: true, Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a> }), { virtual: true });
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

global.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); document.documentElement.dataset.reduceMotion = 'false'; });
afterEach(() => { act(() => root.unmount()); container.remove(); delete document.documentElement.dataset.reduceMotion; jest.restoreAllMocks(); delete window.matchMedia; });

const OVERVIEW = [
  { symbol: 'BTCUSDT', priceChangePercent: 1.5, fundingRate: 0.0001 },
  { symbol: 'DOGEUSDT', priceChangePercent: 9.25, fundingRate: 0.0003 },
  { symbol: 'SOLUSDT', priceChangePercent: -4.5, fundingRate: -0.0002 },
];
const OK = {
  '/futures/symbols': { data: [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }, { symbol: 'SOLUSDT' }] },
  '/instruments/quotes': { data: { rows: [{ symbol: 'A' }, { symbol: 'B' }] } },
  '/providers': { data: { providers: [{ breaker: { state: 'closed' } }, { breaker: { state: 'open' } }, { breaker: { state: 'closed' } }] } },
  '/futures/liquidations': { data: { windows: { '24h': { longUsd: 1000, shortUsd: 500, count: 3 } } } },
  '/futures/overview': { data: OVERVIEW },
};
const mockApi = (over = {}) => usePolling.mockImplementation((url) => {
  const key = Object.keys(OK).find((k) => url.endsWith(k));
  return (over[key] !== undefined ? over[key] : OK[key]);
});
const render = () => act(() => { root.render(<HomeStats />); });
const cards = () => [...container.querySelectorAll('ul')[0].querySelectorAll('li')].map((li) => li.textContent);

test('shows real counts from mocked responses, with reduced motion (no animation)', () => {
  document.documentElement.dataset.reduceMotion = 'true';
  const raf = jest.spyOn(window, 'requestAnimationFrame');
  mockApi();
  render();
  const c = cards();
  expect(c[0]).toContain('3');
  expect(c[1]).toContain('2');
  expect(c[2]).toContain('2');
  expect(c[2]).toContain('of 3');
  expect(c[3]).toContain('$1.5K');
  expect(raf).not.toHaveBeenCalled();
  const pulse = container.querySelectorAll('ul')[1].textContent;
  expect(pulse).toContain('DOGE +9.25%');
  expect(pulse).toContain('SOL -4.50%');
  expect(pulse).toContain('DOGE 0.0300%');
});

test('counts up with requestAnimationFrame when motion is allowed', () => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: false });
  const cbs = [];
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => cbs.push(cb));
  mockApi();
  render();
  expect(cbs.length).toBeGreaterThan(0);
  expect(cards()[0]).toContain('0');
  act(() => { cbs.splice(0).forEach((cb) => cb(performance.now() + 5000)); });
  expect(cards()[0]).toContain('3');
});

test('a failed endpoint shows -- and never a number; other cards still render', () => {
  document.documentElement.dataset.reduceMotion = 'true';
  mockApi({ '/providers': { data: null, error: new Error('x') }, '/futures/overview': { data: null, error: new Error('x') } });
  render();
  const c = cards();
  expect(c[2]).toContain('--');
  expect(c[2]).not.toMatch(/\d/);
  expect(c[0]).toContain('3');
  expect(container.querySelectorAll('ul')[1].textContent.match(/--/g)).toHaveLength(3);
});

test('while loading there are skeletons, no numbers', () => {
  usePolling.mockReturnValue({ data: null });
  render();
  expect([...container.querySelectorAll('ul')[0].querySelectorAll('a > span.text-xl')].map((e) => e.textContent).join('')).toBe('');
  expect(container.textContent).not.toContain('--');
});

test('cards link to their pages', () => {
  mockApi();
  render();
  const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  expect(hrefs.slice(0, 4)).toEqual(['/market', '/stocks', '/docs#data', '/liquidation']);
});

test('pulseOf ignores rows without numbers', () => {
  expect(pulseOf([])).toBeNull();
  expect(pulseOf([{ symbol: 'X', priceChangePercent: null }])).toBeNull();
});

test('Providers up counts the Yahoo-shaped entry whose state is top level, not only breaker.state', () => {
  document.documentElement.dataset.reduceMotion = 'true';
  mockApi({ '/providers': { data: { providers: [{ name: 'binance', breaker: { state: 'closed' } }, { name: 'yahoo', kind: 'stocks', state: 'closed' }, { name: 'bybit', breaker: { state: 'open' } }, { name: 'x', state: 'open' }] } } });
  render();
  expect(cards()[2]).toContain('2');
  expect(cards()[2]).toContain('of 4');
});
