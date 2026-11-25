import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Dashboard from './Dashboard';

jest.mock('react-router-dom', () => {
  const h = require('react').createElement;
  return { Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children) };
}, { virtual: true });
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: () => ({ data: null, loading: false, error: new Error('down') }) }));
jest.mock('../lib/usePortfolio', () => ({ __esModule: true, default: () => ({ holdings: [], balance: NaN, loading: false, error: new Error('down') }) }));
jest.mock('../store/userStore', () => ({ __esModule: true, default: (sel) => sel({ token: null }) }));
jest.mock('../store/alertStore', () => ({ __esModule: true, default: () => ({ alerts: [], events: [], loaded: true, error: 'x', unread: 0, load: () => {} }) }));
jest.mock('../components/ai/CopilotPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/ai/AgentLauncher', () => ({ __esModule: true, default: () => null }));
// A throwing card must be contained by its CardBoundary, not take the page down.
jest.mock('../components/dashboard/MoverBias', () => ({ __esModule: true, default: () => { throw new Error('mover down'); } }));
jest.mock('../components/news/NewsFeed', () => ({ __esModule: true, default: () => { throw new Error('news down'); } }));

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('mounts every section in order without crashing when every request fails', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root.render(<Dashboard />); });
  spy.mockRestore();
  const t = container.textContent;
  const order = ['UTC', 'Market movers', 'Market intelligence', 'Market news', 'Real markets', 'Derivatives pulse', 'Liquidations (sampled)'];
  let at = -1;
  order.forEach((s) => { const i = t.indexOf(s, at + 1); expect(i).toBeGreaterThan(at); at = i; });
  expect(container.querySelector('nav[aria-label="Quick actions"]')).toBeTruthy();
});

test('a throwing card shows its fallback and the rest of the page still renders', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root.render(<Dashboard />); });
  spy.mockRestore();
  expect(container.textContent).toContain('This card could not be shown.');
  expect(container.textContent).toContain('Real markets');
  expect(container.textContent).toContain('Liquidations (sampled)');
});
