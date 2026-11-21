global.IS_REACT_ACT_ENVIRONMENT = true;
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import PositionsTable, { markOf } from './PositionsTable';
import useUserStore from '../../store/userStore';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const pos = { _id: 'p1', symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, mmr: 0.004, liqPrice: 90.36144578, tp: null, sl: null, status: 'open', realizedPnl: 0, markPrice: 100 };
let host; let root;
const mount = async (props) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<PositionsTable {...props} />));
};
const click = async (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const btn = (t) => [...host.querySelectorAll('button')].find((b) => b.textContent === t);
const byLabel = (l) => host.querySelector(`[aria-label="${l}"]`);
beforeEach(() => useUserStore.setState({ token: 'tok', user: null }));
afterEach(() => { if (root) act(() => root.unmount()); if (host) host.remove(); root = null; host = null; jest.resetAllMocks(); });

test('markOf prefers the live price', () => {
  expect(markOf(pos, { BTC: 120 })).toBe(120);
  expect(markOf(pos, {})).toBe(100);
});

test('skeleton, empty state and live summary', async () => {
  await mount({ loading: true });
  expect(host.querySelector('[aria-busy="true"]')).toBeTruthy();
  act(() => root.unmount()); host.remove();
  await mount({ positions: [] });
  expect(host.textContent).toContain('No open positions');
  act(() => root.unmount()); host.remove();
  await mount({ positions: [pos], prices: { BTC: 110 } });
  expect(host.querySelector('[data-testid="pos-summary"]').textContent).toContain('+$10.00');
  expect(host.textContent).toContain('ROE +100.0%');
  expect(host.querySelector('[data-testid="liq-dist"]').textContent).toBe('17.9% away');
});

const menuItem = (t) => [...document.body.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.startsWith(t));
const openMenu = async () => click(byLabel('More close options for BTC long'));

test('Close menu: 25/50/75% post the right partial size, 100% closes all; renders in document.body; Esc closes it', async () => {
  const onChanged = jest.fn();
  axios.post.mockResolvedValue({ data: {} });
  await mount({ positions: [{ ...pos, size: 0.3 }], onChanged });
  await openMenu();
  const menu = document.body.querySelector('[role="menu"]');
  expect(host.contains(menu)).toBe(false);
  expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Close 25%', 'Close 50%', 'Close 75%', 'Close 100%all']);
  expect(document.activeElement).toBe(menuItem('Close 25%')); // keyboard: first item focused
  await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  expect(document.activeElement).toBe(menuItem('Close 50%'));
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(byLabel('More close options for BTC long'));
  expect(axios.post).not.toHaveBeenCalled();
  for (const [t, body] of [['Close 25%', { size: 0.075 }], ['Close 50%', { size: 0.15 }], ['Close 75%', { size: 0.225 }], ['Close 100%', {}]]) {
    await openMenu();
    await click(menuItem(t));
    expect(axios.post.mock.calls.at(-1)[1]).toEqual(body);
  }
  expect(onChanged).toHaveBeenCalledTimes(4);
});

test('full close needs confirm; errors are friendly', async () => {
  await mount({ positions: [pos] });
  await click(byLabel('Close BTC long'));
  expect(axios.post).not.toHaveBeenCalled();
  axios.post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'POSITION_BUSY', message: 'x' } } });
  await click(byLabel('Confirm close all BTC long'));
  expect(axios.post.mock.calls[0][1]).toEqual({});
  expect(host.textContent).toContain('try again in a moment');
});

test('confirm-before-close off (Settings > Preferences): X closes the whole position on the first click', async () => {
  useUserStore.setState({ user: { _id: 'u1', preferences: { confirmClose: false } } });
  axios.post.mockResolvedValueOnce({ data: {} });
  await mount({ positions: [pos] });
  await click(byLabel('Close BTC long'));
  expect(axios.post).toHaveBeenCalledTimes(1);
  expect(axios.post.mock.calls[0][1]).toEqual({});
  expect(byLabel('Confirm close all BTC long')).toBeNull();
});

const setVal = async (label, v) => act(async () => {
  const el = host.querySelector(`[aria-label="${label}"]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const save = () => host.querySelector('[aria-label^="Save changes"]');
const openEdit = async () => click(byLabel('Add TP/SL to BTC long'));

test('Add TP/SL opens the edit panel focused on take profit; TP/SL validated, only changed keys sent', async () => {
  const onChanged = jest.fn();
  axios.patch.mockResolvedValueOnce({ data: {} });
  await mount({ positions: [pos], onChanged });
  await openEdit();
  expect(document.activeElement).toBe(byLabel('Take profit'));
  expect(save().disabled).toBe(true); // nothing changed yet
  await setVal('Take profit', '90');
  expect(host.textContent).toContain('Take profit must be above');
  expect(save().disabled).toBe(true);
  await setVal('Take profit', '120');
  await setVal('Stop loss', '90'); // below liq 90.36
  expect(host.textContent).toContain('above the liquidation price');
  await setVal('Stop loss', '');
  await click(save());
  expect(axios.patch).toHaveBeenCalledWith(expect.stringContaining('/api/futures/positions/p1'), { tp: 120 }, expect.anything());
  expect(onChanged).toHaveBeenCalled();
  expect(host.querySelector('[aria-label^="Save changes"]')).toBeNull(); // panel closed
});

test('leverage preview: released / extra margin and new liq in cents; LIQ_BREACH blocks save; sends leverage', async () => {
  axios.patch.mockResolvedValueOnce({ data: {} });
  await mount({ positions: [pos], prices: { BTC: 100 } });
  await openEdit();
  await click(btn('20x'));
  expect(host.querySelector('[data-testid="margin-delta"]').textContent).toBe('+$5.00');
  expect(host.querySelector('[data-testid="new-liq"]').textContent).toBe('90.3614 → 95.3815');
  expect(host.textContent).toContain('Released to balance');
  await click(btn('5x'));
  expect(host.querySelector('[data-testid="margin-delta"]').textContent).toBe('-$10.00');
  expect(host.textContent).toContain('Extra margin from balance');
  await click(btn('50x')); // liq 98.39 < mark 100: allowed
  expect(save().disabled).toBe(false);
  await click(save());
  expect(axios.patch.mock.calls[0][1]).toEqual({ leverage: 50 });
  act(() => root.unmount()); host.remove();
  await mount({ positions: [pos], prices: { BTC: 98 } }); // 50x liq 98.39 >= mark 98
  await openEdit();
  await click(btn('50x'));
  expect(host.textContent).toContain('would be liquidated at once');
  expect(save().disabled).toBe(true);
});

test('kept SL is re-checked against the new liq; server errors are readable', async () => {
  axios.patch.mockRejectedValueOnce({ response: { status: 400, data: { code: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' } } });
  await mount({ positions: [{ ...pos, sl: 93 }] });
  await click(byLabel('Edit TP/SL of BTC long')); // pencil next to the values once one is set
  expect(document.activeElement).toBe(byLabel('Take profit'));
  await click(btn('20x')); // new liq 95.38 > kept SL 93
  expect(host.textContent).toContain('above the liquidation price');
  expect(save().disabled).toBe(true);
  await click(btn('5x'));
  await click(save());
  expect(axios.patch.mock.calls[0][1]).toEqual({ leverage: 5 });
  expect(host.textContent).toContain('Not enough free balance');
  axios.patch.mockRejectedValueOnce({ response: { status: 400, data: { code: 'LIQ_BREACH', message: 'At 5x the liquidation price X would be past the mark' } } });
  await click(save());
  expect(host.textContent).toContain('would be past the mark');
});

test('the leverage badge opens the same edit panel focused on leverage', async () => {
  await mount({ positions: [pos] });
  await click(byLabel('Edit leverage of BTC long (10x)'));
  expect(host.querySelector('[aria-label^="Save changes"]')).toBeTruthy();
  expect(document.activeElement).toBe(byLabel('Leverage'));
});

test('busy rows are locked (no Edit, no Close)', async () => {
  await mount({ positions: [{ ...pos, busy: true }] });
  expect(host.textContent).toContain('Under review');
  ['Close BTC long', 'More close options for BTC long', 'Add TP/SL to BTC long', 'Edit leverage of BTC long (10x)'].forEach((l) => expect(byLabel(l).disabled).toBe(true));
});

test('partial closes on a dust position are disabled (an empty body would be a full close)', async () => {
  await mount({ positions: [{ ...pos, size: 1e-8 }] });
  await openMenu();
  expect(menuItem('Close 50%').disabled).toBe(true);
  expect(menuItem('Close 100%').disabled).toBe(false);
  await click(menuItem('Close 50%'));
  expect(axios.post).not.toHaveBeenCalled();
});

test('one Close split button per row (no separate pencil / 50%); focus tooltip renders in document.body; Close all disarms after 3 s; TP and SL show in full', async () => {
  jest.useFakeTimers();
  try {
    await mount({ positions: [{ ...pos, tp: 63728.6, sl: 57659.21 }] });
    const actions = host.querySelectorAll('td.sticky.right-0 button');
    expect([...actions].map((b) => b.getAttribute('aria-label'))).toEqual(['Close BTC long', 'More close options for BTC long']);
    expect(byLabel('Close BTC long').textContent).toBe('Close');
    await act(async () => { byLabel('Close BTC long').focus(); });
    const tip = document.body.querySelector('[role="tooltip"]');
    expect(tip.textContent).toBe('Close 100% at market');
    expect(host.contains(tip)).toBe(false);
    expect(byLabel('Close BTC long').getAttribute('aria-describedby')).toBe(tip.id);
    await act(async () => { byLabel('Close BTC long').blur(); });
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    expect(host.textContent).toContain('TP 63,728.60');
    expect(host.textContent).toContain('SL 57,659.21');
    await click(byLabel('Close BTC long'));
    expect(byLabel('Confirm close all BTC long').textContent).toBe('Confirm?');
    await act(async () => { jest.advanceTimersByTime(3100); });
    expect(byLabel('Confirm close all BTC long')).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
