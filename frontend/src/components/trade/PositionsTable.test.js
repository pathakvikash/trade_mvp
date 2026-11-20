global.IS_REACT_ACT_ENVIRONMENT = true;
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import PositionsTable, { validateTpSl, markOf } from './PositionsTable';
import useUserStore from '../../store/userStore';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

const pos = { _id: 'p1', symbol: 'BTC', side: 'long', size: 1, entryPrice: 100, leverage: 10, margin: 10, liqPrice: 90, tp: null, sl: null, status: 'open', realizedPnl: 0, markPrice: 100 };
let host; let root;
const mount = async (props) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<PositionsTable {...props} />));
};
const click = async (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const btn = (t) => [...host.querySelectorAll('button')].find((b) => b.textContent === t);
beforeEach(() => useUserStore.setState({ token: 'tok', user: null }));
afterEach(() => { if (root) act(() => root.unmount()); if (host) host.remove(); root = null; host = null; jest.resetAllMocks(); });

test('validateTpSl applies the server bounds', () => {
  expect(validateTpSl(pos, 100, { tp: 110, sl: 95 })).toEqual({});
  expect(validateTpSl(pos, 100, { tp: 99, sl: 89 })).toEqual({ tp: expect.any(String), sl: expect.any(String) });
  const short = { ...pos, side: 'short', liqPrice: 110 };
  expect(validateTpSl(short, 100, { tp: 90, sl: 105 })).toEqual({});
  expect(validateTpSl(short, 100, { tp: 101, sl: 99 })).toEqual({ tp: expect.any(String), sl: expect.any(String) });
  expect(validateTpSl(pos, 100, { tp: null, sl: null })).toEqual({});
});

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
  expect(host.querySelector('[data-testid="liq-dist"]').textContent).toBe('18.2% away');
});

test('full close needs confirm; 50% posts half size; errors are friendly', async () => {
  const onChanged = jest.fn();
  axios.post.mockResolvedValueOnce({ data: {} });
  await mount({ positions: [pos], onChanged });
  await click(btn('50%'));
  expect(axios.post.mock.calls[0][1]).toEqual({ size: 0.5 });
  expect(onChanged).toHaveBeenCalled();
  await click(btn('Close'));
  expect(axios.post).toHaveBeenCalledTimes(1);
  axios.post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'POSITION_BUSY', message: 'x' } } });
  await click(btn('Yes'));
  expect(axios.post.mock.calls[1][1]).toEqual({});
  expect(host.textContent).toContain('try again in a moment');
});

test('TP/SL edit validates, then PATCHes; busy rows are locked', async () => {
  axios.patch.mockResolvedValueOnce({ data: {} });
  await mount({ positions: [pos] });
  await click(host.querySelector('[aria-label^="Edit TP/SL"]'));
  const setVal = async (label, v) => act(async () => {
    const el = host.querySelector(`[aria-label="${label}"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await setVal('Take profit', '90');
  await click(btn('Save'));
  expect(axios.patch).not.toHaveBeenCalled();
  expect(host.textContent).toContain('TP must be above');
  await setVal('Take profit', '120');
  await click(btn('Save'));
  expect(axios.patch.mock.calls[0][1]).toEqual({ tp: 120, sl: null });
  act(() => root.unmount()); host.remove();
  await mount({ positions: [{ ...pos, busy: true }] });
  expect(host.textContent).toContain('Under review');
  expect(btn('Close').disabled).toBe(true);
});

test('50% on a dust position does nothing (an empty body would be a full close)', async () => {
  await mount({ positions: [{ ...pos, size: 1e-8 }] });
  expect(btn('50%').disabled).toBe(true);
  await click(btn('50%'));
  expect(axios.post).not.toHaveBeenCalled();
});
