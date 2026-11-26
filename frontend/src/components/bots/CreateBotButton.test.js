import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import CreateBotButton from './CreateBotButton';
import useAgentStore from '../../store/agentStore';

const mockNav = jest.fn();
jest.mock('react-router-dom', () => ({ Link: ({ to, children, ...r }) => require('react').createElement('a', { href: to, ...r }, children), useNavigate: () => mockNav }), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../store/userStore', () => ({ __esModule: true, default: (sel) => sel({ token: 't' }) }));

const CFG = { botsEnabled: true, symbols: ['BTC', 'ETH'], intervals: ['5m', '1h'], defaults: { sizeUsd: 1000, leverage: 1, dailyLossUsd: 50, maxTradesPerDay: 10 } };
let el; let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { el = document.createElement('div'); root = createRoot(el); axios.get.mockReset(); axios.post.mockReset(); mockNav.mockReset(); useAgentStore.setState({ open: true, ctx: { kind: 'perp', symbol: 'BTCUSDT', interval: '1h' } }); });
afterEach(() => act(() => root.unmount()));
const draw = (p) => act(() => root.render(<CreateBotButton {...p} />));
const press = async () => { await act(async () => { el.querySelector('button').click(); }); };

test('creates a proposed bot from a saved strategy with the server defaults and links to the accept screen', async () => {
  axios.get.mockResolvedValue({ data: CFG });
  axios.post.mockResolvedValue({ data: { bot: { _id: 'b9' }, describe: 'x' } });
  draw({ strategyId: 's1', spec: { timeframe: '1h' }, name: 'Dip' });
  await press();
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/bots'), { strategyId: 's1', symbol: 'BTC', sizeUsd: 1000, leverage: 1, limits: { dailyLossUsd: 50, maxTradesPerDay: 10 }, name: 'Dip' }, expect.anything());
  expect(el.textContent).toContain('nothing runs until you accept');
  expect(el.querySelector('a').getAttribute('href')).toBe('/bots?bot=b9');
  expect(mockNav).toHaveBeenCalledWith('/bots?bot=b9');
  expect(useAgentStore.getState().open).toBe(false); // dock closes so the accept screen is not covered
});

test('unsaved proposals send the spec; a timeframe bots cannot run is refused before any POST', async () => {
  axios.get.mockResolvedValue({ data: CFG });
  axios.post.mockResolvedValue({ data: { bot: { _id: 'b9' } } });
  draw({ spec: { timeframe: '1m' } });
  await press();
  expect(axios.post).not.toHaveBeenCalled();
  expect(el.textContent).toContain('designed on 1m');
  draw({ spec: { timeframe: '1h', name: 'A' } });
  await press();
  expect(axios.post.mock.calls[0][1].spec).toEqual({ timeframe: '1h', name: 'A' });
});

test('server errors are shown', async () => {
  axios.get.mockResolvedValue({ data: CFG });
  axios.post.mockRejectedValue({ response: { status: 409, data: { error: 'BOT_LIMIT', code: 'BOT_LIMIT' } } });
  draw({ strategyId: 's1', spec: { timeframe: '1h' } });
  await press();
  expect(el.textContent).toContain('Bot limit reached');
});
