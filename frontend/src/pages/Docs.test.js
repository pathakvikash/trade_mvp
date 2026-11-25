import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Docs from './Docs';
import { DOCS_SECTIONS } from '../lib/docsContent';

global.IS_REACT_ACT_ENVIRONMENT = true;
let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = () => act(() => root.render(<Docs />));
const type = (el, value) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  act(() => { set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

test('renders one section per docs entry, with a TOC link to each and a skip link', () => {
  render();
  expect(container.querySelector('h1').textContent).toBe('Docs');
  expect(container.querySelectorAll('section')).toHaveLength(DOCS_SECTIONS.length);
  // desktop and mobile TOCs both render, so each section id is linked twice; plus the skip link and prev/next links
  const toc = [...container.querySelectorAll('nav[aria-label="On this page"] a')];
  expect(toc).toHaveLength(DOCS_SECTIONS.length * 2);
  expect(container.querySelector('a[href="#docs-content"]')).not.toBeNull();
  ['glossary', 'patterns', 'data'].forEach((id) => expect(container.querySelector(`section#${id}`)).not.toBeNull());
  expect(container.querySelector('svg, figure')).not.toBeNull();
});

test('search filters sections and shows an empty state', () => {
  render();
  type(container.querySelector('#docs-search'), 'maintenance');
  const ids = [...container.querySelectorAll('section')].map((s) => s.id);
  expect(ids).toContain('futures');
  expect(ids.length).toBeLessThan(DOCS_SECTIONS.length);
  type(container.querySelector('#docs-search'), 'zzzznotaword');
  expect(container.querySelectorAll('section')).toHaveLength(0);
  expect(container.textContent).toContain('No section matches');
});

test('copy-link button copies the section URL', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  render();
  const btn = container.querySelector('button[aria-label="Copy link to Glossary"]');
  await act(async () => { btn.click(); });
  expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/#glossary$/));
  expect(container.textContent).toContain('Copied');
});

test('previous/next links connect neighbouring sections', () => {
  render();
  const second = container.querySelectorAll('section')[1];
  const hrefs = [...second.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
  expect(hrefs).toEqual([`#${DOCS_SECTIONS[0].id}`, `#${DOCS_SECTIONS[2].id}`]);
});

test('TOC click marks the section as current (no IntersectionObserver fallback)', () => {
  render();
  const link = container.querySelector(`nav[aria-label="On this page"] a[href="#${DOCS_SECTIONS[2].id}"]`);
  act(() => { link.click(); });
  expect(container.querySelector(`nav[aria-label="On this page"] a[aria-current="location"]`).getAttribute('href')).toBe(`#${DOCS_SECTIONS[2].id}`);
});

// Documented figures vs code. Frontend tests do not import the backend, so each row cites where the number lives;
// if a constant changes there, change the docs text and this table together.
const FIGURES = [
  ['$100,000', 'backend/models/User.js:99 PAPER_BALANCE'],
  ['0.1% fee', 'context/DOMAIN.md:38 spot fee (backend/services/tradeMath.js)'],
  ['0.05% taker fee', 'context/DOMAIN.md:55 futuresMath fee 5 bps'],
  ['1x to 50x', 'context/DOMAIN.md:57 leverage 1..50'],
  ['$5', 'context/DOMAIN.md:40 MIN_NOTIONAL_CENTS = 500'],
  ['at most 20 open limit orders', 'context/DOMAIN.md:42 max 20 open orders'],
  ['5x to 125x', 'backend/services/futuresUtils.js:89 LEV_MIX'],
  ['0.4% maintenance', 'backend/services/futuresUtils.js:90 MMR'],
  ['10 AI requests per minute', 'backend/services/ai/aiAccess.js:23 limit 10 / 60 s'],
  ['60 chat requests per day', 'backend/services/ai/aiAccess.js:28 limit 60 / 24 h'],
  ['up to 20 strategies', 'backend/routes/strategyRoutes.js:17 MAX_STRATEGIES'],
];
test.each(FIGURES)('docs state %s (%s)', (text) => {
  render();
  expect(container.textContent).toContain(text.replace(' fee', ''));
});

test('tier table matches backend/services/futuresMath.js:10-14', () => {
  render();
  const rows = [...container.querySelectorAll('#futures tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
  expect(rows).toEqual([
    ['$50,000', '50x', '0.4%'], ['$250,000', '20x', '0.5%'], ['$1,000,000', '10x', '1.0%'], ['$5,000,000', '5x', '2.5%'], ['Above $5,000,000', '2x', '5.0%'],
  ]);
});

test('no invented-claim words', () => {
  render();
  expect(container.textContent).not.toMatch(/guaranteed|risk-free|profit(s)? every|testimonial|breaking news/i);
});

test('the "needs an account" list names every protected page, Dashboard included (App.js protectedRoutes)', () => {
  const line = DOCS_SECTIONS.find((s) => s.id === 'getting-started').bullets.find((b) => b.includes('need an account'));
  ['Dashboard', 'Trade', 'Derivatives', 'Liquidations', 'Portfolio', 'Settings'].forEach((p) => expect(line).toContain(p));
});

test('liquidation map and heatmap fallback wording is truthful (Bybit/Gate rebuild, not "no alternative source")', () => {
  render();
  expect(container.textContent).not.toContain('no alternative source');
  expect(container.textContent).toContain('rebuilt from Bybit or Gate candles and open interest');
});
