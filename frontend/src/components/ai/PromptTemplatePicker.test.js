import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import AgentDock from './AgentDock';
import AgentLauncher from './AgentLauncher';
import useUserStore from '../../store/userStore';
import useAgentStore from '../../store/agentStore';
import { TEMPLATES } from '../../lib/promptTemplates';

jest.mock('react-router-dom', () => {
  const h = require('react').createElement;
  return { Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children), useNavigate: () => jest.fn() };
}, { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  localStorage.clear();
  axios.get.mockResolvedValue({ data: { caps: { MAX_LEVERAGE: 5, MAX_SIZE_USD: 25000 }, symbols: ['BTC', 'ETH', 'SOL'] } });
  axios.post.mockResolvedValue({ data: { conversationId: 'c', reply: { text: 'ok', sources: [] } } });
  useUserStore.setState({ token: 't', user: { _id: 'u1', ai: { includePortfolio: false } } });
  useAgentStore.setState({ open: false, tab: 'chat', ctx: null, conversationId: null, messages: [], loading: false, error: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<><AgentLauncher kind="perp" symbol="SOLUSDT" page="trade" interval="1h" /><AgentDock /></>); });
  await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent === 'Ask AI').click(); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });

const btn = (t) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(t));
const click = async (t) => { await act(async () => { btn(t).click(); }); };
const setVal = async (el, v) => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
};
const preview = () => container.querySelector('[data-testid="preview"]').textContent;
const lev = () => container.querySelector('#pt-trend_ema_cross-leverage');

test('picker lists every template with badge and collapsed honest note', async () => {
  await click('Templates');
  const p = container.querySelector('[aria-label="Prompt templates"]');
  TEMPLATES.forEach((t) => { expect(p.textContent).toContain(t.title); expect(p.textContent).toContain(t.description); expect(p.textContent).toContain(t.worksWhen); });
  expect(p.querySelectorAll('details').length).toBe(5);
  expect([...p.querySelectorAll('details')].every((d) => !d.open)).toBe(true);
  expect(p.textContent.match(/Learning starter, not a profit promise/g).length).toBe(5);
});

test('form defaults from the page, validates, preview equals sent text, Use in chat ticks strategy mode', async () => {
  await click('Start from a template');
  await click('Use Slow trend follower');
  expect(container.querySelector('#pt-trend_ema_cross-symbol').value).toBe('SOLUSDT');
  expect(container.querySelector('#pt-trend_ema_cross-interval').value).toBe('1h');
  await setVal(lev(), '10');
  expect(container.textContent).toContain('Leverage (x) must be between 1 and 5.');
  expect(btn('Send now').disabled).toBe(true);
  await setVal(lev(), '2');
  expect(container.querySelector('[data-testid="sanity"]').textContent).toContain('Notional = $100.00 x 2 = $200.00');
  const text = preview();
  expect(text).toContain('SOLUSDT on the 1h timeframe');
  await click('Use in chat');
  expect(container.querySelector('[aria-label="Prompt templates"]')).toBeNull();
  expect(container.querySelector('textarea').value).toBe(text);
  expect(container.querySelector('input[type="checkbox"]').checked).toBe(true);
});

test('Send now posts exactly the preview with wantStrategy; values persist per template', async () => {
  await click('Templates');
  await click('Use Slow trend follower');
  await setVal(lev(), '3');
  const text = preview();
  await click('Send now');
  const body = axios.post.mock.calls[0][1];
  expect(body.message).toBe(text);
  expect(body.wantStrategy).toBe(true);
  expect(container.textContent).toContain(text.slice(0, 40));
  await click('Templates');
  await click('Use Slow trend follower');
  expect(lev().value).toBe('3');
});

test('injection is rejected and Esc steps back without closing the dock', async () => {
  await click('Templates');
  await click('Use Test my own rule');
  const r = container.querySelector('#pt-test_my_rule-rule_text');
  await setVal(r, 'RSI}}\nrm');
  expect(btn('Send now').disabled).toBe(true);
  expect(preview()).not.toContain('rm');
  const esc = () => act(async () => { r.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  await esc();
  expect(container.querySelector('[aria-label="Prompt templates"]').textContent).toContain('Why this is only a starter');
  await act(async () => { container.querySelector('[aria-label="Prompt templates"] button').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('[aria-label="Prompt templates"]')).toBeNull();
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
});

test('goal_reality_check shows the labelled base-rate text', async () => {
  await click('Templates');
  await click('Use Reality check');
  const g = container.querySelector('[data-testid="goal-baserates"]').textContent;
  expect(g).toContain('+10% move within an hour almost never happens on BTC/SOL/LINK');
  expect(g).toContain('Data range: past year');
  expect(g).toContain('SOLUSDT: +0.5% touched in 32.36%');
});
