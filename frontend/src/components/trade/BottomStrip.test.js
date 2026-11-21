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
const sOrder = { _id: 's1', symbol: 'BTC', side: 'buy', amount: 0.01, limitPrice: 50000, reserved: 500.5, status: 'open', createdAt: new Date(Date.now() - 5 * 60000).toISOString() };
const holdings = [{ symbol: 'DOGE', amount: 100, avgCost: 0.1 }];

let host; let root; let futures;
const mount = async (props = {}) => {
  futures = { positions: [pos], orders: [fOrder], closedPositions: closed, loading: false, error: null, reload: jest.fn(), ...props.futures };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(
    <BottomStrip account={{ holdings, trades: [], loading: false }} prices={{ BTC: 100, DOGE: 0.2 }} futures={futures} orders={props.orders || { rows: [] }} />,
  ));
};
const tab = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith(text));
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

beforeEach(() => localStorage.clear());
beforeEach(() => useUserStore.setState({ token: 'tok', user: null }));
afterEach(() => { act(() => root.unmount()); host.remove(); jest.resetAllMocks(); });

test('tab badges: Positions = futures positions only (spot holdings counted in their own header), Open orders = spot + futures', async () => {
  await mount({ orders: { rows: [sOrder] } });
  const badge = (name) => tab(name).querySelector('[data-testid="tab-count"]')?.textContent;
  expect(badge('Positions')).toBe('1');
  expect(host.querySelector('[data-testid="spot-count"]').textContent).toBe('(1)');
  expect(badge('Open orders')).toBe('2');
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
  expect(host.textContent).toContain('Short 5x');
  expect(host.textContent).toContain('Futures');
  await click(host.querySelector('[aria-label="Cancel ETH short limit order"]'));
  expect(axios.delete.mock.calls[0][0]).toMatch(/\/api\/futures\/orders\/o1$/);
  expect(futures.reload).toHaveBeenCalledTimes(1);
});

test('failed cancel shows an error and does not reload', async () => {
  axios.delete.mockRejectedValue({ message: 'x', response: { status: 400, data: { code: 'NOT_OPEN' } } });
  await mount();
  await click(tab('Open orders'));
  await click(host.querySelector('[aria-label="Cancel ETH short limit order"]'));
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

test('futures limit order: Edit TP/SL validates vs the limit price, PATCHes changed keys, says cancel and re-place for the rest', async () => {
  axios.patch.mockResolvedValue({ data: {} });
  await mount();
  await click(tab('Open orders'));
  await click(host.querySelector('[aria-label="Add TP/SL to ETH short limit order"]'));
  expect(host.textContent).toContain('Price, size or leverage: cancel and re-place');
  const setVal = (label, v) => act(async () => {
    const el = host.querySelector(`[aria-label="${label}"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const save = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Save');
  await setVal('Take profit', '3100'); // short: tp must be below 3000
  expect(host.textContent).toContain('Take profit must be below');
  expect(save().disabled).toBe(true);
  await setVal('Take profit', '2800');
  await setVal('Stop loss', '3600'); // beyond liq ~3585.66
  expect(save().disabled).toBe(true);
  await setVal('Stop loss', '3200');
  await click(save());
  expect(axios.patch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/futures\/orders\/o1$/), { tp: 2800, sl: 3200 }, expect.anything());
  expect(futures.reload).toHaveBeenCalled();
});

test('Open orders lists spot and futures limit orders in one table with reserved funds, TP/SL and age', async () => {
  await mount({ orders: { rows: [sOrder] } });
  await click(tab('Open orders'));
  const table = host.querySelector('table[aria-label="Open orders"]');
  expect(table).toBeTruthy();
  const spot = host.querySelector('[data-testid="order-spot"]').textContent;
  expect(spot).toContain('Spot');
  expect(spot).toContain('Buy');
  expect(spot).toContain('50,000.00');
  expect(spot).toContain('$500.50');
  expect(spot).toContain('5m');
  const fut = host.querySelector('[data-testid="order-futures"]').textContent;
  expect(fut).toContain('Futures');
  expect(fut).toContain('Short 5x');
  expect(fut).toContain('Add TP/SL'); // no TP/SL yet: a subtle link instead of 'TP -- / SL --'
  // one labelled Cancel button per row, no separate edit pencil in the action column
  ['Cancel BTC buy limit order', 'Cancel ETH short limit order'].forEach((l) => {
    expect(host.querySelector(`[aria-label="${l}"]`).textContent).toBe('Cancel');
  });
  expect(host.querySelectorAll('td.sticky button').length).toBe(2);
});

test('futures order with TP/SL shows the values with a pencil next to them; its tooltip renders in document.body on focus', async () => {
  await mount({ futures: { ...futures, orders: [{ ...fOrder, tp: 2800, sl: 3200 }] } });
  await click(tab('Open orders'));
  const fut = host.querySelector('[data-testid="order-futures"]').textContent;
  expect(fut).toContain('TP 2,800.00');
  expect(fut).toContain('SL 3,200.00');
  const pencil = host.querySelector('[aria-label="Edit TP/SL of ETH short limit order"]');
  await act(async () => { pencil.focus(); });
  const tip = document.body.querySelector('[role="tooltip"]');
  expect(tip.textContent).toBe('Edit TP / SL');
  expect(host.contains(tip)).toBe(false); // portal: outside every scroll container / sticky cell
  expect(pencil.getAttribute('aria-describedby')).toBe(tip.id);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
});

test('spot cancel goes to the page handler with the order id, not the futures API', async () => {
  const onCancel = jest.fn();
  await mount({ orders: { rows: [sOrder], onCancel } });
  await click(tab('Open orders'));
  await click(host.querySelector('[aria-label="Cancel BTC buy limit order"]'));
  expect(onCancel).toHaveBeenCalledWith('s1');
  expect(axios.delete).not.toHaveBeenCalled();
});

test('Open orders empty state explains limit orders and shows no badge', async () => {
  await mount({ futures: { orders: [] } });
  expect(tab('Open orders').querySelector('[data-testid="tab-count"]')).toBeNull();
  await click(tab('Open orders'));
  const empty = host.querySelector('[data-testid="orders-empty"]').textContent;
  expect(empty).toContain('No open orders. Limit orders you place wait here until the price is reached, then fill automatically.');
  expect(empty).toContain('Limit');
});
