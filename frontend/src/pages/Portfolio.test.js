global.IS_REACT_ACT_ENVIRONMENT = true;
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import Portfolio from './Portfolio';
import useUserStore from '../store/userStore';

// react-router-dom 7 is unresolvable under Jest 27 (see GoogleButton.test.js); Portfolio only needs Link.
jest.mock('react-router-dom', () => ({ Link: ({ children }) => children }), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));

let host;
let root;
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  axios.get.mockReset();
});

test('first load shows skeleton numbers and rows, never $0.00 or an empty table', async () => {
  useUserStore.setState({ token: 'tok', user: null });
  axios.get.mockImplementation(() => new Promise(() => {})); // requests stay in flight
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Portfolio />));

  const text = host.textContent;
  expect(text).toContain('Loading your portfolio');
  expect(text).not.toContain('$0.00');
  expect(text).not.toContain('No holdings yet.');
  expect(text).not.toContain('No transactions yet.');
  expect(host.querySelectorAll('.motion-safe\\:animate-pulse').length).toBeGreaterThan(0);
  expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
});
