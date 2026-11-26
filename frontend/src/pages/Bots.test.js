import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import Bots from './Bots';
import BotList from '../components/bots/BotList';
import useAgentStore from '../store/agentStore';

const mockParams = { bot: null };
const mockSet = jest.fn();
jest.mock('react-router-dom', () => ({ __esModule: true, useSearchParams: () => [new URLSearchParams(mockParams.bot ? `bot=${mockParams.bot}` : ''), mockSet] }), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock('../store/userStore', () => ({ __esModule: true, default: (sel) => sel({ token: 't' }) }));
// polled GETs by URL suffix: value = data, an Error = failure, undefined = loading
const mockPoll = {};
jest.mock('../lib/usePolling', () => ({
  __esModule: true,
  default: (url) => {
    if (!url) return { data: null, error: null, loading: false };
    const k = Object.keys(mockPoll).find((s) => url.includes(s));
    const v = k === undefined ? undefined : mockPoll[k];
    if (v instanceof Error) return { data: null, error: v, loading: false };
    return v === undefined ? { data: null, error: null, loading: true } : { data: v, error: null, loading: false };
  },
}));

const CFG = { botsEnabled: true, caps: { MAX_BOTS: 5, MAX_RUNNING: 3, MAX_LEVERAGE: 5, MAX_SIZE_USD: 25000 }, defaults: {}, disclosure: 'Paper money only. DISCLOSURE-TEXT', disclosureVersion: 1 };
const bot = (o = {}) => ({ _id: 'b1', name: 'Dip buyer', symbol: 'BTC', interval: '1h', sizeUsd: 1000, leverage: 2, status: 'proposed', accepted: false, acceptHash: 'h1',
  spec: { risk: { stopPct: 2 } }, limits: { maxPositionUsd: 1000, maxLeverage: 2, dailyLossUsd: 50, maxTradesPerDay: 10, symbols: ['BTC'] }, day: { trades: 0, realizedCents: 0 }, ...o });
const PERF = { pnl: { netCents: -1234, realizedNetCents: -1234, unrealizedCents: 0, feesCents: 500, feesShareOfGross: null }, benchmark: { netCents: 800, notionalCents: 100000 }, vsBenchmarkCents: -2034,
  trades: { n: 3, open: 0, wins: 1, losses: 2, maxDrawdownCents: 900 }, evidence: { n: 3, label: 'Too few trades to mean anything', ci95Pct: { low: -2, high: 1 }, note: 'Consistent with no edge', basis: 'BASIS' },
  drift: { missed: 0, skipped: 1, skipReasons: { DAILY_LOSS: 1 }, available: false }, disclosures: ['DISC-A', 'DISC-B', 'DISC-C'] };

let container; let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  Object.keys(mockPoll).forEach((k) => delete mockPoll[k]);
  mockParams.bot = null; mockSet.mockClear(); Object.values(axios).forEach((f) => f.mockReset());
  axios.post.mockResolvedValue({ data: bot() });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const draw = async () => { await act(async () => { root.render(<Bots />); }); };
const btn = (re) => [...container.querySelectorAll('button')].find((b) => re.test(b.textContent));
const click = async (b) => { await act(async () => { b.click(); }); };

test('list shows status badge, symbol, interval and P&L vs buy-and-hold; loading and error states', async () => {
  mockPoll['/api/bots/config'] = CFG;
  mockPoll['/api/bots/b2/performance'] = PERF;
  mockPoll['/api/bots'] = [bot(), bot({ _id: 'b2', name: 'Runner', status: 'running', startedAt: '2026-01-01' })];
  await draw();
  const t = container.textContent;
  expect(t).toContain('proposed'); expect(t).toContain('running');
  expect(t).toContain('BTC · 1h'); expect(t).toContain('P&L -$12.34'); expect(t).toContain('vs buy-and-hold -$20.34');
  expect(t).not.toMatch(/profitable|leaderboard|projected/i);
  delete mockPoll['/api/bots']; await draw();
  expect(container.querySelector('[aria-label="Loading bots"]')).toBeTruthy();
  mockPoll['/api/bots'] = new Error('down'); await draw();
  expect(container.textContent).toContain('Could not load bots');
});

test('a malformed row is contained by its boundary', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => { root.render(<BotList bots={[null, bot({ _id: 'g', name: 'Good' })]} selectedId={null} onSelect={() => {}} onChanged={() => {}} />); });
  spy.mockRestore();
  expect(container.textContent).toContain('could not be shown'); expect(container.textContent).toContain('Good');
});

test('accept screen shows exact terms and disclosures; Accept stays disabled until the checkbox is ticked', async () => {
  mockParams.bot = 'b1';
  mockPoll['/api/bots/config'] = CFG; mockPoll['/api/bots'] = [bot()];
  await draw();
  const t = container.textContent;
  ['Dip buyer', 'BTC perpetual', '1h', '$1,000', '2x', '$50', 'Hard caps', 'DISCLOSURE-TEXT', 'Not financial advice', 'No funding is simulated'].forEach((s) => expect(t).toContain(s));
  expect(container.querySelector('[aria-label="Disclosures"]').textContent).toContain('Funding is not charged');
  expect(btn(/^Accept$/).disabled).toBe(true);
  expect(btn(/^Decline$/).disabled).toBe(false);
  await click(container.querySelector('input[type="checkbox"]'));
  expect(btn(/^Accept$/).disabled).toBe(false);
  await click(btn(/^Accept$/));
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/bots/b1/accept'), { acceptHash: 'h1', ack: true }, expect.anything());
});

test('accept error is shown in plain words', async () => {
  mockParams.bot = 'b1';
  mockPoll['/api/bots/config'] = CFG; mockPoll['/api/bots'] = [bot()];
  axios.post.mockRejectedValue({ response: { status: 409, data: { error: 'HASH_MISMATCH', code: 'HASH_MISMATCH' } } });
  await draw();
  await click(container.querySelector('input[type="checkbox"]'));
  await click(btn(/^Accept$/));
  expect(container.textContent).toContain('changed since this screen loaded');
});

test('detail: performance with evidence label, interval wording, all three disclosures, decisions as-is; kill and edit warning', async () => {
  mockParams.bot = 'b2';
  mockPoll['/api/bots/config'] = CFG;
  mockPoll['/api/bots/b2/performance'] = PERF;
  mockPoll['/api/bots/b2/decisions'] = [{ _id: 'd1', at: '2026-01-01T10:00:00Z', kind: 'tick', action: 'skip', status: 'done', reason: { signal: 'long', conds: [{ text: 'rsi lt 30', left: 24.5, right: 30, ok: true }], guard: 'DAILY_LOSS' } }];
  mockPoll['/api/bots'] = [bot({ _id: 'b2', status: 'paused', accepted: true, startedAt: '2026-01-01' })];
  await draw();
  const t = container.textContent;
  ['Too few trades to mean anything', 'Consistent with no edge', '95% interval', '-2% to 1%', 'DISC-A', 'DISC-B', 'DISC-C', 'rsi lt 30: 24.5 vs 30 (met)', 'guard: DAILY_LOSS', 'Net P&L'].forEach((s) => expect(t).toContain(s));
  expect(btn(/^Start$/).disabled).toBe(false);
  await click(btn(/Kill: stop bot/));
  expect(axios.post).not.toHaveBeenCalled(); // kill needs a confirm
  await click(btn(/Yes, kill bot/));
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/bots/b2/stop'), undefined, expect.anything());
  await click(btn(/Edit size and limits/));
  expect(container.textContent).toContain('clears your acceptance');
  await click(btn(/Save and clear acceptance/));
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/api/bots/b2'), expect.objectContaining({ sizeUsd: 1000, limits: expect.objectContaining({ dailyLossUsd: 50 }) }), expect.anything());
});

test('performance error still shows the three disclosures', async () => {
  mockParams.bot = 'b2';
  mockPoll['/api/bots/config'] = CFG; mockPoll['/api/bots/b2/performance'] = new Error('x'); mockPoll['/api/bots/b2/decisions'] = [];
  mockPoll['/api/bots'] = [bot({ _id: 'b2', status: 'running', startedAt: 'x' })];
  await draw();
  expect(container.textContent).toContain('Performance unavailable');
  expect(container.querySelectorAll('[aria-label="Disclosures"] li').length).toBe(3);
});

test('Stop all asks for confirmation and posts once', async () => {
  mockPoll['/api/bots/config'] = CFG; mockPoll['/api/bots'] = [bot({ status: 'running', startedAt: 'x' })]; mockPoll['/performance'] = PERF;
  await draw();
  await click(btn(/^Stop all bots$/));
  expect(axios.post).not.toHaveBeenCalled();
  const yes = btn(/Yes, stop all bots/);
  await click(yes);
  expect(axios.post.mock.calls.filter((c) => c[0].includes('/stop-all')).length).toBe(1);
});

test('disabled notice when the server has bots off; Start is disabled', async () => {
  mockParams.bot = 'b1';
  mockPoll['/api/bots/config'] = { ...CFG, botsEnabled: false }; mockPoll['/api/bots'] = [bot({ status: 'paused', accepted: true })];
  mockPoll['/api/bots/b1/performance'] = PERF; mockPoll['/api/bots/b1/decisions'] = [];
  await draw();
  expect(container.textContent).toContain('Bots are disabled on this server');
  expect(btn(/^Start$/).disabled).toBe(true);
});

test('selected proposed bot shows the 3-step progress, plain status, plain-English terms, exact spec behind a disclosure, Back on mobile', async () => {
  mockParams.bot = 'b1';
  mockPoll['/api/bots/config'] = CFG;
  mockPoll['/api/bots'] = [bot({ spec: { direction: 'long', entry: { long: { all: [{ left: 'rsi', op: 'lt', right: 30 }] } }, risk: { stopPct: 2 } } })];
  await draw();
  const steps = container.querySelector('[aria-label="Progress"]');
  expect(steps.textContent).toMatch(/1 Review terms.*2 Accept.*3 Start/);
  expect(steps.querySelector('[aria-current="step"]').textContent).toContain('Review terms');
  const t = container.textContent;
  expect(t).toContain('Proposed: waiting for your approval');
  expect(t).toContain('Enters long when rsi is below 30.');
  expect(container.querySelector('details pre')).toBeTruthy();
  expect(container.textContent).toContain('Show exact spec');
  await click(btn(/Back to bots/));
  expect(mockSet).toHaveBeenCalledWith({});
});

test('accepted-not-started bot is on step 3 with Start as the primary action; accept success is shown inline', async () => {
  mockParams.bot = 'b1';
  mockPoll['/api/bots/config'] = CFG; mockPoll['/api/bots/b1/performance'] = PERF; mockPoll['/api/bots/b1/decisions'] = [];
  mockPoll['/api/bots'] = [bot({ status: 'paused', accepted: true })];
  axios.post.mockResolvedValue({ data: {} });
  await draw();
  expect(container.querySelector('[aria-label="Progress"] [aria-current="step"]').textContent).toContain('Start');
  expect(container.textContent).toContain('Accepted: ready to start');
  await click(btn(/^Start$/));
  expect(container.textContent).toContain('Started. Decisions appear below.');
});

test('killed bot says why; empty list explains how bots work and opens the AI panel on Strategies', async () => {
  mockParams.bot = 'b3';
  mockPoll['/api/bots/config'] = CFG; mockPoll['/api/bots/b3/performance'] = PERF; mockPoll['/api/bots/b3/decisions'] = [];
  mockPoll['/api/bots'] = [bot({ _id: 'b3', status: 'killed', startedAt: 'x' })];
  await draw();
  expect(container.textContent).toContain('Killed: daily loss limit hit');
  mockParams.bot = null; mockPoll['/api/bots'] = [];
  await draw();
  expect(container.textContent).toContain('How bots work');
  await click(btn(/Open AI panel: Strategies/));
  expect(useAgentStore.getState().open).toBe(true);
  expect(useAgentStore.getState().tab).toBe('strategies');
});
