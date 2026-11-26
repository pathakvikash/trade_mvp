import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import BotDetail from './BotDetail';
import BotAccept from './BotAccept';

jest.mock('react-router-dom', () => ({ Link: ({ to, children }) => <a href={to}>{children}</a> }), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../store/userStore', () => ({ __esModule: true, default: (sel) => sel({ token: 't' }) }));
jest.mock('./BotPerformance', () => ({ __esModule: true, default: () => null, Disclosures: () => null }));
jest.mock('./DecisionFeed', () => ({ __esModule: true, default: () => null }));

const todayKey = new Date().toISOString().slice(0, 10);
const BOT = { _id: 'b1', name: 'B', symbol: 'BTC', interval: '1h', status: 'paused', accepted: true, sizeUsd: 1000, leverage: 2, acceptHash: 'h1', spec: {},
  limits: { dailyLossUsd: 50, maxTradesPerDay: 10, maxPositionUsd: 2000, maxLeverage: 3, symbols: ['BTC'] } };
let el; let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el); axios.post.mockReset(); });
afterEach(() => { act(() => root.unmount()); el.remove(); });
const render = (ui) => act(() => root.render(ui));
// React tracks the value itself, so go through the native setter to fire a real change event.
const type = (input, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

test('limits form keeps focus and accumulates multi-digit values across keystrokes', () => {
  render(<BotDetail bot={BOT} cfg={{}} onChanged={() => {}} />);
  act(() => [...el.querySelectorAll('button')].find((b) => b.textContent.startsWith('Edit size')).click());
  const input = el.querySelector('input');
  act(() => input.focus());
  let node = input;
  ['1', '12', '123'].forEach((v) => {
    type(node, v);
    node = el.querySelector('input');
    expect(node).toBe(input); // not remounted
    expect(document.activeElement).toBe(input);
    expect(node.value).toBe(v);
  });
});

test("today's numbers: previous UTC day shows zeros, today shows the bot's day", () => {
  render(<BotDetail bot={{ ...BOT, day: { key: '2020-01-01', trades: 7, realizedCents: -500 } }} cfg={{}} onChanged={() => {}} />);
  expect(el.textContent).toContain('No trades today.');
  expect(el.textContent).toContain("Today's trades0 of 10");
  render(<BotDetail bot={{ ...BOT, day: { key: todayKey, trades: 7, realizedCents: -500 } }} cfg={{}} onChanged={() => {}} />);
  expect(el.textContent).toContain("Today's trades7 of 10");
  expect(el.textContent).not.toContain('No trades today.');
});

test('accept sends the hash loaded on mount; a changed hash resets the ack and warns', async () => {
  axios.post.mockResolvedValue({ data: BOT });
  const bot = { ...BOT, status: 'proposed' };
  render(<BotAccept bot={bot} cfg={{}} onChanged={() => {}} />);
  const box = () => el.querySelector('input[type=checkbox]');
  act(() => box().click());
  expect(box().checked).toBe(true);
  render(<BotAccept bot={{ ...bot, acceptHash: 'h2' }} cfg={{}} onChanged={() => {}} />);
  expect(box().checked).toBe(false);
  expect(el.textContent).toContain('terms changed');
  const accept = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Accept');
  expect(accept.disabled).toBe(true);
  act(() => box().click()); // re-review and tick again: now accepts the new terms
  await act(async () => { accept.click(); });
  expect(axios.post.mock.calls[0][1]).toEqual({ acceptHash: 'h2', ack: true });
});

test('accept without a change sends the mount hash', async () => {
  axios.post.mockResolvedValue({ data: BOT });
  render(<BotAccept bot={{ ...BOT, status: 'proposed' }} cfg={{}} onChanged={() => {}} />);
  act(() => el.querySelector('input[type=checkbox]').click());
  await act(async () => { [...el.querySelectorAll('button')].find((b) => b.textContent === 'Accept').click(); });
  expect(axios.post.mock.calls[0][1]).toEqual({ acceptHash: 'h1', ack: true });
});
