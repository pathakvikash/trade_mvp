import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import { safeNext } from './orrery';
import OrreryStrip from '../components/shell/OrreryStrip';
import Sso from '../pages/Sso';
import useUserStore from '../store/userStore';

const mockNavigate = jest.fn();
let mockQuery = '';
jest.mock('react-router-dom', () => {
  const R = require('react');
  return {
    __esModule: true,
    Link: ({ to, children }) => R.createElement('a', { href: to }, children),
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams(mockQuery)],
  };
}, { virtual: true });
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

const mount = async (el) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  return { container, unmount: () => act(() => root.unmount()) };
};

test('safeNext keeps same-origin relative paths only', () => {
  expect(safeNext('/trade?symbol=BTC')).toBe('/trade?symbol=BTC');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'trade', '', null, undefined, 5, '/a b']) {
    expect(safeNext(bad)).toBeNull();
  }
});

test('strip is hidden without a URL and links to Orrery with one', async () => {
  const off = await mount(<OrreryStrip url="" />);
  expect(off.container.innerHTML).toBe('');
  await off.unmount();
  const on = await mount(<OrreryStrip url="https://orrery.example" />);
  expect(on.container.querySelector('a').getAttribute('href')).toBe('https://orrery.example');
  await on.unmount();
});

describe('/sso page', () => {
  beforeEach(() => { mockNavigate.mockClear(); axios.post.mockReset(); useUserStore.setState({ token: null, user: null }); });

  test('stores the session and goes to a safe next', async () => {
    mockQuery = 'token=T&next=/trade%3Fsymbol%3DETH';
    axios.post.mockResolvedValue({ data: { token: 'jwt', user: { _id: '1', email: 'a@b.c', name: 'A', preferences: {} } } });
    const m = await mount(<Sso />);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][1]).toEqual({ token: 'T' });
    expect(useUserStore.getState().token).toBe('jwt');
    expect(mockNavigate).toHaveBeenCalledWith('/trade?symbol=ETH', { replace: true });
    await m.unmount();
  });

  test('no account: login with the email prefilled, nothing stored', async () => {
    mockQuery = 'token=T&next=https%3A%2F%2Fevil.com';
    axios.post.mockRejectedValue({ response: { status: 404, data: { code: 'NO_ACCOUNT', email: 'new@b.c' } } });
    const m = await mount(<Sso />);
    expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true, state: { email: 'new@b.c', next: null } });
    expect(useUserStore.getState().token).toBeNull();
    await m.unmount();
  });

  test('missing token or an invalid one shows the message', async () => {
    mockQuery = '';
    let m = await mount(<Sso />);
    expect(m.container.textContent).toMatch(/invalid or has expired/);
    expect(axios.post).not.toHaveBeenCalled();
    await m.unmount();
    mockQuery = 'token=bad';
    axios.post.mockRejectedValue({ response: { status: 401, data: { success: false } } });
    m = await mount(<Sso />);
    expect(m.container.textContent).toMatch(/invalid or has expired/);
    await m.unmount();
  });
});
