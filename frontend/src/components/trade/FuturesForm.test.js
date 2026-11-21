import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import FuturesForm from './FuturesForm';

jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn(), get: jest.fn() } }));

const config = { minNotional: 5, defaultMaxLev: 20, symbolMaxLev: { BTC: 50 }, tiers: [{ maxNotional: 50000, maxLev: 50, mmr: 0.004 }, { maxNotional: null, maxLev: 20, mmr: 0.005 }] };
let container;
let root;
let futures;
let account;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => localStorage.clear());
afterEach(() => { act(() => root.unmount()); container.remove(); jest.resetAllMocks(); });

const mount = async (props = {}) => {
  futures = { config, positions: [], reload: jest.fn(), ...props.futures };
  account = { balance: 1000, reload: jest.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<FuturesForm coin={{ symbol: 'BTC', price: 100 }} symbols={['BTC']} overview={[]} onSymbol={() => {}} token="t" futures={futures} account={account} />);
  });
};
const $ = (sel) => container.querySelector(sel);
const setValue = (el, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = () => $('button[type="submit"]');
const btn = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent === text);

test('disabled with a reason until a size is entered; preview shows margin and fee', async () => {
  await mount();
  expect(submit().disabled).toBe(true);
  expect(container.textContent).toContain('Enter a size.');
  await setValue($('#fut-size'), '1'); // $100 notional, 10x -> $10 margin, $0.05 fee
  expect(submit().disabled).toBe(false);
  expect(submit().textContent).toBe('Open long 10x BTC');
  expect(container.textContent).toContain('$10.00');
});

test('disabled while config is missing', async () => {
  await mount({ futures: { config: null } });
  await setValue($('#fut-size'), '1');
  expect(submit().disabled).toBe(true);
  expect(container.textContent).toContain('Loading futures settings');
});

test('50% quick-fill sizes to half the balance at the chosen leverage', async () => {
  await mount();
  await act(async () => { btn('50%').click(); });
  // 500 / (100 * (1/10 + 0.0005)) = 49.7512...
  expect(Number($('#fut-size').value)).toBeCloseTo(49.751243, 4);
});

test('debit over balance disables submit', async () => {
  await mount();
  await setValue($('#fut-size'), '200'); // $20000 notional -> $2000 margin > $1000
  expect(submit().disabled).toBe(true);
  expect(container.textContent).toContain('Not enough balance');
});

test('submit posts the order, shows fill price and fee, and reloads futures + account', async () => {
  axios.post.mockResolvedValue({ data: { fill: { price: 100, fee: 0.05 }, balance: 989.95 } });
  await mount();
  await setValue($('#fut-size'), '1');
  await act(async () => { submit().click(); });
  const [url, body] = axios.post.mock.calls[0];
  expect(url).toMatch(/\/api\/futures\/orders$/);
  expect(body).toEqual({ symbol: 'BTC', side: 'long', type: 'market', size: 1, leverage: 10 });
  expect(container.textContent).toContain('Opened long 10x 1 BTC @ 100.00');
  expect(futures.reload).toHaveBeenCalled();
  expect(account.reload).toHaveBeenCalled();
  expect($('#fut-size').value).toBe('');
});

test('after a fill the cleared size is explained and focused, and a second order goes through', async () => {
  axios.post.mockResolvedValue({ data: { fill: { price: 100, fee: 0.05 }, balance: 989.95 } });
  await mount();
  await setValue($('#fut-size'), '1');
  await act(async () => { submit().click(); });
  expect(container.textContent).toContain('Enter a size for the next order.');
  expect(document.activeElement).toBe($('#fut-size'));
  expect(submit().disabled).toBe(true);
  await setValue($('#fut-size'), '1');
  await act(async () => { submit().click(); });
  expect(axios.post).toHaveBeenCalledTimes(2);
});

test('codes without a friendly entry and 401s still read as sentences', async () => {
  await mount();
  await setValue($('#fut-size'), '1');
  axios.post.mockRejectedValueOnce({ message: 'x', response: { status: 500, data: { code: 'OP_FAILED', message: 'Operation failed' } } });
  await act(async () => { submit().click(); });
  expect($('[role="alert"]').textContent).toContain('could not be completed');
  axios.post.mockRejectedValueOnce({ message: 'x', response: { status: 401, data: { message: 'Invalid token' } } });
  await act(async () => { submit().click(); });
  expect($('[role="alert"]').textContent).toContain('session has expired');
});

test('server error codes become friendly text', async () => {
  axios.post.mockRejectedValue({ message: 'x', response: { status: 400, data: { success: false, code: 'MAX_POSITIONS', message: 'raw' } } });
  await mount();
  await setValue($('#fut-size'), '1');
  await act(async () => { submit().click(); });
  expect(container.textContent).toContain('maximum number of open positions');
  expect(futures.reload).not.toHaveBeenCalled();
});

test('same symbol+side open: leverage locked, add note with new average entry', async () => {
  await mount({ futures: { positions: [{ status: 'open', symbol: 'BTCUSDT', side: 'long', size: 1, entryPrice: 80, leverage: 5, margin: 16 }] } });
  await setValue($('#fut-size'), '1');
  expect(container.textContent).toContain('Adds to your open long');
  expect(container.textContent).toContain('New avg entry $90.00');
  expect(submit().textContent).toBe('Add long 5x BTC');
  expect(container.querySelector('input[type="range"]').disabled).toBe(true);
});

test('success resets TP/SL (keeps side/leverage) and the message clears on the next edit', async () => {
  axios.post.mockResolvedValue({ data: { fill: { price: 100, fee: 0.05 }, balance: 989.95 } });
  await mount();
  await act(async () => { btn('Short').click(); });
  await act(async () => { $('#fut-tpsl-enable').click(); });
  await setValue($('#fut-size'), '1');
  await setValue($('#fut-tpsl-tp'), '90');
  await act(async () => { submit().click(); });
  expect(axios.post.mock.calls[0][1]).toMatchObject({ side: 'short', tp: 90 });
  expect(container.textContent).toContain('Opened short 10x 1 BTC');
  expect($('#fut-tpsl-tp').value).toBe('');
  expect($('#fut-tpsl-enable').checked).toBe(true);
  expect(submit().textContent).toBe('Open short 10x BTC');
  await setValue($('#fut-size'), '2');
  expect(container.textContent).not.toContain('Opened short');
});

test('message can be dismissed', async () => {
  axios.post.mockRejectedValue({ message: 'x', response: { status: 400, data: { code: 'MAX_POSITIONS' } } });
  await mount();
  await setValue($('#fut-size'), '1');
  await act(async () => { submit().click(); });
  expect($('[role="alert"]').textContent).toContain('maximum number');
  await act(async () => { $('button[aria-label="Dismiss message"]').click(); });
  expect($('[role="alert"]')).toBeNull();
});

test('previews use the server config: tier mmr/fee rate and leverage cap', async () => {
  const c = { minNotional: 5, defaultMaxLev: 3, symbolMaxLev: {}, takerFeeRate: 0.001, tiers: [{ maxNotional: null, maxLev: 3, mmr: 0.1 }] };
  await mount({ futures: { config: c } });
  expect(container.querySelector('input[type="range"]').max).toBe('3');
  await setValue($('#fut-size'), '1');
  expect(container.textContent).toContain('Fee (0.1%)');
  expect(container.textContent).toContain('$0.10');
});
