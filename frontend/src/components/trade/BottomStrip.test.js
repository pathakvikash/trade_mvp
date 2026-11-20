global.IS_REACT_ACT_ENVIRONMENT = true;
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import BottomStrip from './BottomStrip';
import useUserStore from '../../store/userStore';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('../ai/CopilotPanel', () => () => null);

const pos = { _id: 'p1', symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, liqPrice: 90, status: 'open', realizedPnl: 0, markPrice: 100 };
const fOrder = { _id: 'o1', symbol: 'ETH', side: 'short', leverage: 5, size: 2, limitPrice: 3000, status: 'open' };
const closed = [
  { _id: 'c1', symbol: 'BTC', side: 'long', leverage: 10, size: 1, closeReason: 'manual', exitPrice: 110, realizedPnl: 9.9, fees: 0.1 },
  { _id: 'c2', symbol: 'SOL', side: 'short', leverage: 20, size: 3, closeReason: 'liquidation', exitPrice: 150, realizedPnl: -10, fees: 0.1 },
];
const holdings = [{ symbol: 'DOGE', amount: 100, avgCost: 0.1 }];

let host; let root; let futures;
const mount = async (props = {}) => {
  futures = { positions: [pos], orders: [fOrder], closedPositions: closed, loading: false, error: null, reload: jest.fn(), ...props.futures };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(
    <BottomStrip account={{ holdings, trades: [], loading: false }} prices={{ BTC: 100, DOGE: 0.2 }} futures={futures} orders={{ rows: [] }} />,
  ));
};
const tab = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith(text));
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => localStorage.clear());
beforeEach(() => useUserStore.setState({ token: 'tok', user: null }));
afterEach(() => { act(() => root.unmount()); host.remove(); jest.resetAllMocks(); });

test('tab badges count futures + spot positions and futures + spot open orders', async () => {
  await mount();
  const badge = (name) => tab(name).querySelector('[data-testid="tab-count"]')?.textContent;
  expect(badge('Positions')).toBe('2'); // 1 futures + 1 spot holding
  expect(badge('Open orders')).toBe('1');
  expect(tab('History').querySelector('[data-testid="tab-count"]')).toBeNull();
});

test('Positions tab shows the futures table and spot holdings', async () => {
  await mount();
  expect(host.querySelector('table[aria-label="Open futures positions"]')).toBeTruthy();
  expect(host.querySelector('table[aria-label="Spot holdings"]')).toBeTruthy();
  expect(host.textContent).toContain('DOGE');
});

test('futures limit order row cancels via DELETE then reloads', async () => {
  axios.delete.mockResolvedValue({ data: {} });
  await mount();
  await click(tab('Open orders'));
  expect(host.textContent).toContain('Short 5x ETH');
  expect(host.textContent).toContain('Futures');
  await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
  expect(axios.delete.mock.calls[0][0]).toMatch(/\/api\/futures\/orders\/o1$/);
  expect(futures.reload).toHaveBeenCalledTimes(1);
});

test('failed cancel shows an error and does not reload', async () => {
  axios.delete.mockRejectedValue({ message: 'x', response: { status: 400, data: { code: 'NOT_OPEN' } } });
  await mount();
  await click(tab('Open orders'));
  await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
  expect(host.textContent).toContain('no longer open');
  expect(futures.reload).not.toHaveBeenCalled();
});

test('History lists closed futures positions and labels liquidated rows', async () => {
  await mount();
  await click(tab('History'));
  const rows = [...host.querySelectorAll('tbody tr')];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Closed');
  expect(rows[0].className).not.toContain('bg-rose-500/10');
  expect(rows[1].textContent).toContain('Liquidated');
  expect(rows[1].textContent).toContain('SOL');
  expect(rows[1].className).toContain('bg-rose-500/10');
});
