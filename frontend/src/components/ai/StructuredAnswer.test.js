import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import StructuredAnswer from './StructuredAnswer';
import AgentDock from './AgentDock';
import AgentLauncher from './AgentLauncher';
import CreateBotButton from '../bots/CreateBotButton';
import { longFixture, shortFixture } from './structuredFixture';
import { clampPlan, mdLines } from '../../lib/agentReply';
import useUserStore from '../../store/userStore';
import useAgentStore from '../../store/agentStore';

jest.mock('react-router-dom', () => {
  const h = require('react').createElement;
  return { Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children), useNavigate: () => jest.fn() };
}, { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));

let el; let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  axios.get.mockResolvedValue({ data: [] });
  useUserStore.setState({ token: 't', user: { ai: { includePortfolio: false } } });
  useAgentStore.setState({ open: false, tab: 'chat', ctx: null, conversationId: null, messages: [], loading: false, error: null });
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
});
afterEach(() => { act(() => root.unmount()); el.remove(); jest.clearAllMocks(); });
const draw = (ui) => act(() => { root.render(ui); });
const xs = () => Object.fromEntries([...el.querySelectorAll('[data-ladder]')].map((g) => [g.dataset.ladder, Number(g.dataset.x)]));

test('long ladder reads stop < entry < target; short is reversed; marker present', () => {
  draw(<StructuredAnswer s={longFixture} />);
  let p = xs();
  expect(p.Stop).toBeLessThan(p.Entry); expect(p.Entry).toBeLessThan(p.Target); expect(p.Now).toBeDefined();
  expect(el.textContent).toContain('Long');
  draw(<StructuredAnswer s={shortFixture} />);
  p = xs();
  expect(p.Target).toBeLessThan(p.Entry); expect(p.Entry).toBeLessThan(p.Stop);
});

test('levels are nearest-first with distance; bull/bear/risks/needs render', () => {
  draw(<StructuredAnswer s={longFixture} />);
  const rows = [...el.querySelectorAll('[aria-label="Levels"] li')].map((l) => l.textContent);
  expect(rows[0]).toContain('Support');
  expect(rows[0]).toContain('%');
  expect(el.textContent).toContain('Holding support');
  expect(el.querySelector('[aria-label="Risks"]').textContent).toContain('Wide spread');
  expect(el.textContent).toContain('Needs data: order book');
});

test('missing fields do not crash', () => {
  draw(<StructuredAnswer s={{ verdict: 'avoid', plan: { side: 'long' }, levels: [{ price: 'x' }, null] }} />);
  expect(el.textContent).toContain('Avoid');
  expect(el.querySelector('svg')).toBeNull();
  draw(<StructuredAnswer s={{}} />);
  expect(el.textContent).toContain('Neutral');
});

test('clampPlan respects hard caps; mdLines handles bullets and bold', () => {
  expect(clampPlan({ sizeUsd: 99999, leverage: 20 }, { MAX_SIZE_USD: 25000, MAX_LEVERAGE: 5 })).toEqual({ sizeUsd: 25000, leverage: 5 });
  expect(clampPlan({ sizeUsd: 'a', leverage: 0 }, {})).toEqual({});
  expect(mdLines('- a **b**')[0]).toEqual({ bullet: true, parts: [{ t: 'a ', b: false }, { t: 'b', b: true }, { t: '', b: false }] });
});

test('CreateBotButton prefills from the plan, clamped to /api/bots/config caps', async () => {
  useAgentStore.setState({ ctx: { kind: 'perp', symbol: 'BTCUSDT' } });
  axios.get.mockResolvedValue({ data: { botsEnabled: true, symbols: ['BTC'], intervals: ['1h'], caps: { MAX_SIZE_USD: 500, MAX_LEVERAGE: 3 }, defaults: { sizeUsd: 1000, leverage: 1, dailyLossUsd: 50, maxTradesPerDay: 10 } } });
  axios.post.mockResolvedValue({ data: { bot: { _id: 'b1' } } });
  draw(<CreateBotButton spec={{ timeframe: '1h' }} plan={{ sizeUsd: 9000, leverage: 10 }} />);
  await act(async () => { el.querySelector('button').click(); });
  expect(axios.post.mock.calls[0][1]).toMatchObject({ sizeUsd: 500, leverage: 3 });
});

const reply = (r) => ({ data: { conversationId: 'c1', reply: { text: 'plain **bold**', sources: [], ...r } } });
const open = async () => {
  await act(async () => { root.render(<><AgentLauncher kind="perp" symbol="BTCUSDT" page="trade" interval="15m" /><AgentDock /></>); });
  await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Ask AI')).click(); });
};
const send = async (v) => {
  const ta = el.querySelector('textarea');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
};

test('chat: structured renders, sources collapsed, text fallback, trade intent auto-ticks and sends wantStrategy', async () => {
  axios.post.mockResolvedValueOnce(reply({ structured: longFixture, strategyMode: 'auto', sources: [{ section: 's', source: 'x', estimate: true }] }));
  await open();
  await send('go ahead and trade');
  expect(el.querySelector('input[type="checkbox"]').checked).toBe(true);
  expect(axios.post.mock.calls[0][1].wantStrategy).toBe(true);
  expect(el.textContent).toContain('Trade plan');
  expect(el.textContent).toContain('Strategy mode was switched on');
  expect(el.querySelector('details').open).toBe(false);
  expect(el.querySelector('details summary').textContent).toContain('Sources (1)');
  expect(el.textContent).toContain('Estimates only, paper trading, not advice.');
  axios.post.mockResolvedValueOnce(reply({}));
  await send('hello');
  expect(el.querySelector('b').textContent).toBeTruthy();
  expect(el.textContent).toContain('plain');
});

test('chat: error shows Retry which resends the same message', async () => {
  axios.post.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockResolvedValueOnce(reply({}));
  await open();
  await send('hello');
  const retry = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
  expect(retry).toBeTruthy();
  await act(async () => { retry.click(); });
  expect(axios.post.mock.calls[1][1].message).toBe('hello');
  expect(useAgentStore.getState().messages.filter((m) => m.role === 'user')).toHaveLength(1);
});
