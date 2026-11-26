import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import NewsItem from './NewsItem';
import usePolling from '../lib/usePolling';

let mockId = '1';
jest.mock('react-router-dom', () => ({ __esModule: true, Link: ({ to, children, className }) => <a href={to} className={className}>{children}</a>, useParams: () => ({ id: mockId }) }), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: jest.fn() }));

const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
const ITEMS = [
  { id: '1', title: 'Bitcoin up', link: 'https://a.com/1', source: 'CoinDesk', category: 'crypto', publishedAt: iso(12), image: 'https://img.x/a.jpg', summary: 'Plain <b>text</b> summary' },
  { id: '2', title: 'Unsafe', link: 'javascript:alert(1)', source: 'Mint', category: 'india', publishedAt: iso(5), image: null, summary: '' },
];
let container; let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });
const render = async (id, res = {}) => {
  mockId = id; usePolling.mockReturnValue(res.data !== undefined || res.error ? res : { data: { item: ITEMS.find((x) => x.id === id), disclaimer: 'd' }, error: null, loading: false });
  await act(async () => { root.render(<NewsItem />); });
};

test('detail: image, summary as text, safe external button, back link, disclaimer', async () => {
  await render('1');
  expect(usePolling.mock.calls[0][0]).toMatch(/\/api\/news\/1$/);
  expect(container.querySelector('img').getAttribute('src')).toBe('https://img.x/a.jpg');
  expect(container.querySelector('h1').textContent).toBe('Bitcoin up');
  expect(container.textContent).toContain('Plain <b>text</b> summary');
  expect(container.querySelector('article b')).toBeNull();
  const a = [...container.querySelectorAll('a')].find((x) => x.textContent.startsWith('Read full article'));
  expect(a.textContent).toBe('Read full article on CoinDesk');
  expect(a.getAttribute('href')).toBe('https://a.com/1');
  expect(a.rel).toBe('noopener noreferrer nofollow');
  expect(a.target).toBe('_blank');
  expect(container.querySelector('a[href="/news"]')).not.toBeNull();
  expect(container.textContent).toContain('not investment advice');
});

test('image failure shows fallback tile', async () => {
  await render('1');
  await act(async () => { container.querySelector('img').dispatchEvent(new Event('error')); });
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('[data-testid=news-fallback]').textContent).toBe('C');
});

test('no image: fallback; unsafe link: no button', async () => {
  await render('2');
  expect(container.querySelector('[data-testid=news-fallback]').textContent).toBe('M');
  expect([...container.querySelectorAll('a')].some((x) => x.textContent.startsWith('Read full'))).toBe(false);
  expect(container.querySelector('a[href^="javascript"]')).toBeNull();
});

test('404: friendly not-found state with link back', async () => {
  await render('zzz', { data: null, error: { response: { status: 404 } }, loading: false });
  expect(container.textContent).toContain('no longer in the feed');
  expect(container.querySelector('a[href="/news"]')).not.toBeNull();
});

test('other error: unavailable, not "no longer in the feed"; loading shows skeleton', async () => {
  await render('zzz', { data: null, error: { response: { status: 500 } }, loading: false });
  expect(container.querySelector('[role=alert]').textContent).toContain('unavailable');
  expect(container.textContent).not.toContain('no longer in the feed');
  await render('zzz', { data: null, error: null, loading: true });
  expect(container.querySelector('[aria-label="Loading news"]')).not.toBeNull();
  expect(container.textContent).not.toContain('no longer in the feed');
});
