import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import Settings from './Settings';
import useUserStore from '../store/userStore';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));

const ME = {
  success: true,
  user: {
    _id: 'u1', username: 'ana', email: 'ana@example.com', name: 'Ana Lopez', role: 'user', createdAt: '2026-01-02T00:00:00Z',
    profile: { bio: '', country: 'ES', timezone: 'Europe/Madrid' },
    preferences: { defaultSymbol: 'ETHUSDT', defaultTimeframe: '5m', alertToasts: true, alertSound: false },
    ai: { model: null },
  },
  aiModels: [{ id: 'small', label: 'Small', note: 'Cheap' }],
};

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(async () => {
  axios.get.mockResolvedValue({ data: ME });
  useUserStore.setState({ token: 't', user: ME.user });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Settings />); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

const tabLabels = () => [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);
const saveButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save');
// React tracks input values itself, so set through the native setter and dispatch the event React listens for.
const typeInto = (el, value) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

test('renders the four tabs and keeps Save disabled until a profile field changes', async () => {
  expect(tabLabels()).toEqual(['Profile', 'AI & model', 'Preferences', 'Security']);
  expect(container.querySelector('#set-name').value).toBe('Ana Lopez');
  expect(saveButton().disabled).toBe(true);

  await act(async () => { typeInto(container.querySelector('#set-name'), 'Ana Maria Lopez'); });
  expect(saveButton().disabled).toBe(false);
});
