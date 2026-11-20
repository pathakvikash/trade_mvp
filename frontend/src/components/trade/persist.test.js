global.IS_REACT_ACT_ENVIRONMENT = true;
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import OrderCard from './OrderCard';
import BottomStrip from './BottomStrip';
import { readPersisted } from '../../lib/usePersistedState';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../ai/CopilotPanel', () => () => null);

const config = { minNotional: 5, defaultMaxLev: 20, symbolMaxLev: { BTC: 50, ETH: 25 }, tiers: [{ maxNotional: null, maxLev: 50, mmr: 0.004 }] };
let host;
let root;
const render = async (el) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(el));
};
const remount = async (el) => { act(() => root.unmount()); host.remove(); await render(el); };
const btn = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith(text));
const click = (text) => act(async () => { btn(text).click(); });
const card = (sym) => (
  <OrderCard
    spot={{ coin: { symbol: sym, price: 100 }, symbols: [sym], overview: [], onSubmit: jest.fn(), message: { type: '', text: '' } }}
    futures={{ coin: { symbol: sym, price: 100 }, symbols: [sym], overview: [], token: 't', futures: { config, positions: [], reload: jest.fn() }, account: { balance: 1000 } }}
  />
);

beforeEach(() => localStorage.clear());
afterEach(() => { act(() => root.unmount()); host.remove(); });

test('mode and leverage per symbol survive a remount', async () => {
  await render(card('BTC'));
  await click('Futures');
  await click('5x');
  await remount(card('BTC'));
  expect(btn('Futures').getAttribute('aria-selected')).toBe('true');
  expect(host.querySelector('input[type="range"]').value).toBe('5');
  await remount(card('ETH')); // other symbol keeps its own (default) leverage
  expect(host.querySelector('input[type="range"]').value).toBe('10');
  expect(readPersisted('trade.fut.leverage', {})).toEqual({ BTC: 5 });
});

test('legacy order-mode key is honoured, invalid stored values fall back', async () => {
  localStorage.setItem('order-mode', 'futures');
  await render(card('BTC'));
  expect(btn('Futures').getAttribute('aria-selected')).toBe('true');
  localStorage.setItem('tm:v1:anon:trade.mode', JSON.stringify('margin'));
  localStorage.setItem('tm:v1:anon:trade.fut.leverage', JSON.stringify({ BTC: 99 }));
  await remount(card('BTC'));
  expect(btn('Futures').getAttribute('aria-selected')).toBe('true'); // legacy fallback
  expect(host.querySelector('input[type="range"]').value).toBe('10'); // 99 rejected
});

test('stored leverage above the symbol cap is clipped on use', async () => {
  localStorage.setItem('tm:v1:anon:trade.mode', JSON.stringify('futures'));
  localStorage.setItem('tm:v1:anon:trade.fut.leverage', JSON.stringify({ ETH: 50 }));
  await render(card('ETH'));
  expect(host.querySelector('input[type="range"]').value).toBe('25');
});

test('bottom tab survives a remount; an invalid stored tab falls back to positions', async () => {
  const strip = <BottomStrip account={{ holdings: [], trades: [] }} futures={{ positions: [], orders: [], closedPositions: [] }} orders={{ rows: [] }} />;
  await render(strip);
  await click('Open orders');
  await remount(strip);
  expect(btn('Open orders').getAttribute('aria-selected')).toBe('true');
  localStorage.setItem('tm:v1:anon:trade.bottomTab', JSON.stringify('nope'));
  await remount(strip);
  expect(btn('Positions').getAttribute('aria-selected')).toBe('true');
});
