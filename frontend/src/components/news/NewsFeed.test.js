import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import NewsFeed, { timeAgo } from './NewsFeed';
import News from '../../pages/News';
import usePolling from '../../lib/usePolling';

jest.mock('react-router-dom', () => ({ __esModule: true, Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a> }), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const DATA = {
  disclaimer: 'x',
  items: [
    { id: '1', title: 'Bitcoin up', link: 'https://a.com/1', source: 'CoinDesk', category: 'crypto', publishedAt: iso(12) },
    { id: '2', title: '<img src=x onerror=alert(1)> Sensex', link: 'javascript:alert(1)', source: 'Mint', category: 'india', publishedAt: iso(90) },
    { id: '3', title: 'Third', link: 'http://b.com/3', source: 'Decrypt', category: 'crypto', publishedAt: iso(0) },
  ],
  sources: [{ name: 'CoinDesk', category: 'crypto', ok: true }, { name: 'Mint', category: 'india', ok: false }],
};
const ok = (data) => ({ data, error: null, loading: false });

let container; let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
const render = async (res, el = <NewsFeed />) => {
  usePolling.mockReturnValue(res);
  await act(async () => { root.render(el); });
  return container.textContent;
};

test('renders items, sources line, always-on disclaimer', async () => {
  const t = await render(ok(DATA));
  expect(t).toContain('Bitcoin up');
  expect(t).toContain('12 min ago');
  expect(t).toContain('1 of 2 sources responding');
  expect(t).toContain('Mint: not ok');
  expect(t).toContain('not investment advice');
});

test('links: rel set, only http(s), HTML in title is text', async () => {
  await render(ok(DATA));
  const as = [...container.querySelectorAll('li a')];
  expect(as).toHaveLength(2);
  as.forEach((a) => { expect(a.rel).toBe('noopener noreferrer nofollow'); expect(a.target).toBe('_blank'); expect(a.href).toMatch(/^https?:/); });
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('<img src=x onerror=alert(1)> Sensex');
});

test('tab switch requests that category', async () => {
  await render(ok(DATA));
  expect(usePolling.mock.calls.at(-1)[0]).toContain('limit=30&category=all');
  const tab = [...container.querySelectorAll('[role=tab]')].find((b) => b.textContent === 'India');
  await act(async () => { tab.click(); });
  expect(usePolling.mock.calls.at(-1)[0]).toContain('category=india');
});

test('loading, error with retry, stale', async () => {
  expect(await render({ data: null, error: null, loading: true }) ).toContain('not investment advice');
  expect(container.querySelector('[aria-label="Loading news"]')).not.toBeNull();
  await render({ data: null, error: new Error('x'), loading: false });
  expect(container.textContent).toContain('News is unavailable');
  const before = usePolling.mock.calls.length;
  await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry').click(); });
  expect(usePolling.mock.calls.at(-1)[2]).toBe(1);
  expect(usePolling.mock.calls.length).toBeGreaterThan(before);
  expect(usePolling.mock.calls.at(-1)[4]).toBe(true);
  await render(ok({ ...DATA, stale: true }));
  expect(container.textContent).toContain('Showing earlier headlines, refresh failed');
});

test('compact: limit, view-all link, no tabs', async () => {
  await render(ok(DATA), <NewsFeed compact limit={6} category="crypto" />);
  expect(usePolling.mock.calls.at(-1)[0]).toContain('limit=6&category=crypto');
  expect(container.querySelector('[role=tablist]')).toBeNull();
  expect(container.querySelector('a[href="/news"]').textContent).toBe('View all news');
  expect(container.querySelector('details')).toBeNull();
});

test('timeAgo', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  expect(timeAgo('2026-11-26T11:48:00Z', now)).toBe('12 min ago');
  expect(timeAgo('2026-11-26T09:00:00Z', now)).toBe('3 h ago');
  expect(timeAgo('2026-11-24T12:00:00Z', now)).toBe('2 d ago');
  expect(timeAgo('2026-11-26T12:00:30Z', now)).toBe('just now');
  expect(timeAgo('garbage', now)).toBe('');
});

test('News page heading, intro and sources', async () => {
  const t = await render(ok(DATA), <News />);
  expect(container.querySelector('h1').textContent).toBe('News');
  expect(t).toContain('we do not republish articles');
  expect(t).toContain('Economic Times');
  expect(t).toContain('Business Standard');
});
