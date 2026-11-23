import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import AuthShell, { PasswordInput } from './AuthShell';
import usePolling from '../../lib/usePolling';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

global.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (el) => act(() => { root.render(el); });

const row = (symbol, lastPrice, pct) => ({ symbol, lastPrice, high: lastPrice * 1.02, low: lastPrice * 0.98, priceChangePercent: pct });

test('shows live rows from the overview data, green up and red down', () => {
  usePolling.mockReturnValue({ data: [row('BTCUSDT', 60000, 1.5), row('ETHUSDT', 3000, -2.25)] });
  render(<AuthShell title="T" subtitle="S"><p>form</p></AuthShell>);
  const strip = container.querySelector('section[aria-label="Live futures prices"]');
  expect(strip.textContent).toContain('BTC');
  expect(strip.textContent).toContain('60,000');
  expect(strip.textContent).toContain('+1.50%');
  expect(strip.textContent).toContain('-2.25%');
  expect(strip.textContent).toContain('Live');
  expect(strip.querySelector('.text-emerald-400')).not.toBeNull();
  expect(strip.querySelector('.text-red-400')).not.toBeNull();
});

test('falls back to placeholder rows when the fetch fails, with no error text', () => {
  usePolling.mockReturnValue({ data: null, error: new Error('Network Error') });
  render(<AuthShell title="T" subtitle="S"><p>form</p></AuthShell>);
  const strip = container.querySelector('section[aria-label="Live futures prices"]');
  expect(strip.querySelectorAll('li')).toHaveLength(5);
  expect(strip.textContent).toContain('Connecting');
  expect(strip.textContent).not.toMatch(/error|failed/i);
  expect(container.textContent).toContain('form');
});

test('password toggle switches the input type and announces its state', () => {
  render(<PasswordInput id="p" name="password" defaultValue="x" />);
  const input = container.querySelector('#p');
  const btn = container.querySelector('button');
  expect(input.type).toBe('password');
  expect(btn.getAttribute('aria-label')).toBe('Show password');
  act(() => { btn.click(); });
  expect(input.type).toBe('text');
  expect(btn.getAttribute('aria-label')).toBe('Hide password');
  expect(btn.getAttribute('aria-pressed')).toBe('true');
});

test('waking-up hint appears only after 4s of busy', () => {
  jest.useFakeTimers();
  usePolling.mockReturnValue({ data: null });
  render(<AuthShell title="T" subtitle="S" busy><p>form</p></AuthShell>);
  expect(container.querySelector('[role="status"]')).toBeNull();
  act(() => { jest.advanceTimersByTime(4100); });
  expect(container.querySelector('[role="status"]').textContent).toContain('Waking up the server');
  jest.useRealTimers();
});
