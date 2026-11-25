import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Home from './Home';
import usePolling from '../lib/usePolling';
import useUserStore from '../store/userStore';

jest.mock('react-router-dom', () => ({ __esModule: true, Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a> }), { virtual: true });
jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

global.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(() => { useUserStore.setState({ token: null, user: null }); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = () => act(() => { root.render(<Home />); });

test('CTAs link to register and login', () => {
  usePolling.mockReturnValue({ data: null });
  render();
  const hrefs = (label) => [...container.querySelectorAll('a')].filter((a) => a.textContent === label).map((a) => a.getAttribute('href'));
  expect(hrefs('Start free')[0]).toBe('/register');
  expect(hrefs('Sign in')).toEqual(['/login']);
});

test('no fabricated-claim words and a current-year footer', () => {
  usePolling.mockReturnValue({ data: null });
  render();
  expect(container.textContent).not.toMatch(/testimonial|reviews?\b|rated|enterprise|low fees|24\/7|million|users trust/i);
  expect(container.querySelector('footer').textContent).toContain(`${new Date().getFullYear()}`);
  expect(container.querySelector('footer').textContent).toContain('Paper trading only. Not financial advice.');
});

test('shows skeleton rows when the market fetch fails', () => {
  usePolling.mockReturnValue({ data: null, error: new Error('Network Error') });
  render();
  const strip = container.querySelector('section[aria-label="Live futures prices"]');
  expect(strip.querySelectorAll('li')).toHaveLength(5);
  expect(strip.textContent).toContain('Connecting');
});

test('FAQ details toggle open and closed', () => {
  usePolling.mockReturnValue({ data: null });
  render();
  const d = container.querySelector('details');
  expect(d.open).toBe(false);
  act(() => { d.open = true; d.dispatchEvent(new Event('toggle')); });
  expect(d.open).toBe(true);
  expect(container.querySelectorAll('details summary').length).toBe(4);
});

const links = (label) => [...container.querySelectorAll('a')].filter((a) => a.textContent === label).map((a) => a.getAttribute('href'));

test('signed in: single Open dashboard CTA (hero + closing), no Start free / Sign in', () => {
  usePolling.mockReturnValue({ data: null });
  useUserStore.setState({ token: 't', user: { id: '1', preferences: {} } });
  render();
  expect(links('Open dashboard')).toEqual(['/dashboard', '/dashboard']);
  expect(links('Start free')).toEqual([]);
  expect(links('Sign in')).toEqual([]);
  expect(container.textContent).not.toContain('No card required');
});

test('signed in: Open dashboard follows the landing-page preference', () => {
  usePolling.mockReturnValue({ data: null });
  useUserStore.setState({ token: 't', user: { id: '1', preferences: { landingPage: 'trade' } } });
  render();
  expect(links('Open dashboard')).toEqual(['/trade', '/trade']);
});

test('token without user stays signed out (same rule as ProtectedRoute)', () => {
  usePolling.mockReturnValue({ data: null });
  useUserStore.setState({ token: 't', user: null });
  render();
  expect(links('Open dashboard')).toEqual([]);
  expect(links('Start free')).toEqual(['/register', '/register']);
});
