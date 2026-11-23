import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import AgentDock from './AgentDock';
import AgentLauncher from './AgentLauncher';
import StrategyCard from './StrategyCard';
import useUserStore from '../../store/userStore';
import useAgentStore from '../../store/agentStore';
import useStrategyStore from '../../store/strategyStore';

jest.mock('react-router-dom', () => {
  const h = require('react').createElement;
  return { Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children) };
}, { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  axios.get.mockResolvedValue({ data: [] });
  useUserStore.setState({ token: 't', user: { ai: { includePortfolio: false } } });
  useAgentStore.setState({ open: false, ctx: null, conversationId: null, messages: [], loading: false, error: null });
  useStrategyStore.setState({ active: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<><AgentLauncher kind="perp" symbol="BTCUSDT" page="trade" interval="1h" /><AgentDock /></>); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.clearAllMocks(); });

const btn = (t) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(t) || b.getAttribute('aria-label')?.includes(t));
const openDock = async () => { const l = btn('Ask AI'); l.focus(); await act(async () => { l.click(); }); return l; };
const type = async (v) => {
  const ta = container.querySelector('textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return ta;
};
const send = async (v) => { const ta = await type(v); await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); };
const reply = (r) => ({ data: { conversationId: 'c1', disclaimer: 'x', reply: { text: 'hi', strategy: null, sources: [], dataGaps: [], ...r } } });

test('dock opens with page context, Esc closes, focus returns to launcher', async () => {
  const l = await openDock();
  const d = container.querySelector('[role="dialog"]');
  expect(d.getAttribute('aria-label')).toBe('AI analyst');
  expect(d.textContent).toContain('BTCUSDT · Trade · 1h');
  expect(d.textContent).toContain('Analysis only, not financial advice. Paper trading.');
  expect(d.textContent).toContain('Include my portfolio');
  await act(async () => { d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(l);
});

test('send flow posts context + wantStrategy and shows reply with source badges', async () => {
  axios.post.mockResolvedValue(reply({ text: 'Looks range-bound', sources: [{ section: 'liqHeat', source: 'binance', asOf: 'now', estimate: true }, { section: 'macro', source: 'yahoo', delayed: true }] }));
  await openDock();
  await act(async () => { container.querySelector('input[type="checkbox"]').click(); });
  await send('what now?');
  const [url, body] = axios.post.mock.calls[0];
  expect(url).toContain('/api/ai/agent/chat');
  expect(body).toMatchObject({ message: 'what now?', wantStrategy: true, context: { kind: 'perp', symbol: 'BTCUSDT', page: 'trade', interval: '1h' } });
  const t = container.textContent;
  expect(t).toContain('Looks range-bound');
  expect(t).toContain('estimate');
  expect(t).toContain('delayed');
  expect(useAgentStore.getState().conversationId).toBe('c1');
});

test('429 shows rate limit message; no-key shows Settings > AI link', async () => {
  axios.post.mockRejectedValueOnce({ response: { status: 429, data: { error: 'rate_limited' } } });
  await openDock();
  await send('a');
  expect(container.textContent).toContain('Rate limited');
  axios.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'ai_no_key' } } });
  await send('b');
  expect(container.textContent).toContain('AI is not configured');
  expect(container.querySelector('a[href="/settings/ai"]')).not.toBeNull();
});

test('model text is inert: <img onerror> renders as text, no img element', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  axios.post.mockResolvedValue(reply({ text: evil, strategy: { spec: {}, describe: evil, backtest: { stats: {}, caveats: [evil] } } }));
  await openDock();
  await send('x');
  expect(container.textContent).toContain(evil);
  expect(container.querySelector('img')).toBeNull();
});

test('StrategyCard always shows caveats and the overfitting warning', async () => {
  const el = document.createElement('div');
  const r = createRoot(el);
  await act(async () => { r.render(<StrategyCard strategy={{ describe: 'Buy dips', backtest: { stats: { trades: 12 }, caveats: ['Small sample'] } }} />); });
  expect(el.textContent).toContain('Small sample');
  expect(el.textContent).toContain('Overfitting warning');
  expect(el.textContent).toContain('Buy dips');
  await act(async () => { r.render(<StrategyCard strategy={{ describe: 'd', backtest: { stats: {}, caveats: [] } }} />); });
  expect(el.querySelector('[role="alert"]').textContent).toContain('Overfitting');
  act(() => r.unmount());
});

test('Show on chart evaluates and sets the active strategy; Save 409 shows limit message', async () => {
  const strategy = { spec: { a: 1 }, describe: 'Buy dips', backtest: { stats: {}, caveats: ['c'] } };
  axios.post.mockResolvedValueOnce(reply({ strategy }));
  await openDock();
  await send('make one');
  axios.post.mockResolvedValueOnce({ data: { series: [], markers: [] } });
  await act(async () => { btn('Show on chart').click(); });
  expect(axios.post.mock.calls[1][0]).toContain('/api/strategies/evaluate');
  expect(useStrategyStore.getState().active).toMatchObject({ symbol: 'BTCUSDT', kind: 'perp', interval: '1h', spec: { a: 1 } });
  axios.post.mockRejectedValueOnce({ response: { status: 409, data: { error: 'STRATEGY_LIMIT' } } });
  await act(async () => { btn('Save').click(); });
  expect(axios.post.mock.calls[2][0]).toMatch(/\/api\/strategies$/);
  expect(container.textContent).toContain('saved-strategy limit');
});

test('Strategies tab lists items and deletes', async () => {
  axios.get.mockImplementation((u) => Promise.resolve({ data: u.endsWith('/api/strategies') ? [{ _id: 's1', name: 'Dip buyer', spec: {} }] : [] }));
  axios.delete.mockResolvedValue({});
  await openDock();
  await act(async () => { btn('Strategies').click(); });
  expect(container.textContent).toContain('Dip buyer');
  await act(async () => { btn('Delete Dip buyer').click(); });
  expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/api/strategies/s1'), expect.anything());
  expect(container.textContent).not.toContain('Dip buyer');
});

test('a reply that lands after the context switched is dropped (not appended to the other conversation)', async () => {
  let resolve;
  axios.post.mockReturnValue(new Promise((r) => { resolve = r; }));
  await openDock();
  await send('btc?');
  await act(async () => { useAgentStore.getState().openWith({ kind: 'perp', symbol: 'ETHUSDT', page: 'trade', interval: '1h' }); });
  await act(async () => { resolve(reply({ text: 'BTC answer' })); });
  const s = useAgentStore.getState();
  expect(s.messages).toEqual([]);
  expect(s.conversationId).toBeNull();
  expect(s.loading).toBe(false);
  expect(container.textContent).not.toContain('BTC answer');
});

test('closing the dock aborts the in-flight request and clears loading', async () => {
  axios.post.mockReturnValue(new Promise(() => {}));
  await openDock();
  await send('hi');
  const { signal } = axios.post.mock.calls[0][2];
  await act(async () => { useAgentStore.getState().close(); });
  expect(signal.aborted).toBe(true);
  expect(useAgentStore.getState().loading).toBe(false);
});

test('opening a past conversation sets ctx from its scope, keeping the page', async () => {
  await act(async () => { useAgentStore.getState().openWith({ kind: 'perp', symbol: 'BTCUSDT', page: 'trade', interval: '1h' }); });
  await act(async () => { useAgentStore.getState().openConv({ conversationId: 'c9', scope: 'instrument:TCS', messages: [{ role: 'user', text: 'q' }] }); });
  const s = useAgentStore.getState();
  expect(s.ctx).toEqual({ kind: 'instrument', symbol: 'TCS', page: 'trade' });
  expect(s.conversationId).toBe('c9');
});

test('sign-out resets the agent and strategy stores', async () => {
  await act(async () => { useAgentStore.getState().openWith({ kind: 'perp', symbol: 'BTCUSDT', page: 'trade' }); useAgentStore.getState().patch({ conversationId: 'c1', messages: [{ role: 'user', text: 'x' }], error: { msg: 'e' } }); useStrategyStore.getState().setActive({ spec: {} }); });
  await act(async () => { useAgentStore.getState().signOut(); useStrategyStore.getState().clear(); });
  const s = useAgentStore.getState();
  expect([s.open, s.ctx, s.conversationId, s.messages, s.error]).toEqual([false, null, null, [], null]);
  expect(useStrategyStore.getState().active).toBeNull();
});

test('Include my portfolio link closes the dock', async () => {
  await openDock();
  const a = [...container.querySelectorAll('a')].find((x) => x.textContent === 'Include my portfolio');
  await act(async () => { a.click(); });
  expect(useAgentStore.getState().open).toBe(false);
});
