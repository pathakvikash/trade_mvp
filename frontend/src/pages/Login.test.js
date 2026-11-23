import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import Login from './Login';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('react-router-dom', () => {
  const React = require('react');
  return {
    __esModule: true,
    Link: ({ to, children, ...rest }) => React.createElement('a', { href: to, ...rest }, children),
    useNavigate: () => jest.fn(),
  };
}, { virtual: true });
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: () => ({ data: null }) }));
jest.mock('../components/auth/GoogleButton', () => ({ __esModule: true, default: () => null }));

global.IS_REACT_ACT_ENVIRONMENT = true;

test('labels are tied to inputs and a failed sign-in is announced with role=alert', async () => {
  axios.get.mockResolvedValue({ data: {} });
  axios.post.mockRejectedValue({ message: 'bad', response: { status: 401, data: { message: 'Invalid credentials' } } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Login />); });

  expect(container.querySelector('label[for="login-email"]')).not.toBeNull();
  expect(container.querySelector('#login-password')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();

  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const alert = container.querySelector('[role="alert"]');
  expect(alert.textContent).toBe('Invalid credentials');

  act(() => root.unmount());
  container.remove();
});
