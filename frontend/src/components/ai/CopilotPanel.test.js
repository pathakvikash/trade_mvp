import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import CopilotPanel from './CopilotPanel';
import useUserStore from '../../store/userStore';

// This checkout's react-router-dom has no dist/ build, so stub the exports used here (Link, MemoryRouter).
jest.mock('react-router-dom', () => {
  const h = require('react').createElement;
  return {
    Link: ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children),
    MemoryRouter: ({ children }) => children,
  };
}, { virtual: true });

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(async () => {
  axios.get.mockResolvedValue({ data: { configured: false, model: 'claude-sonnet-5-5' } });
  useUserStore.setState({ token: 't' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><CopilotPanel symbol="BTCUSDT" /></MemoryRouter>);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

const button = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));

test('when not configured the ask input and Generate stay enabled and Generate shows the setup card', async () => {
  const input = container.querySelector('input[aria-label="Ask about BTCUSDT"]');
  expect(input.disabled).toBe(false);
  expect(container.textContent).toContain('Model: Sonnet 5.5');
  expect(button('Generate brief').disabled).toBe(false);

  await act(async () => { button('Generate brief').click(); });
  expect(container.textContent).toContain('Connect Claude to enable the Copilot');
  expect(container.textContent).toContain('Nothing is billed until a key is added and you click a button.');
  expect(axios.post).not.toHaveBeenCalled();
});

test('Check again re-fetches the status and the card clears once configured', async () => {
  axios.get.mockResolvedValueOnce({ data: { configured: true, model: 'claude-sonnet-5-5' } });
  await act(async () => { button('Check again').click(); });
  expect(axios.get).toHaveBeenLastCalledWith(expect.stringContaining('/api/ai/status'), expect.anything());
  expect(container.textContent).not.toContain('Connect Claude to enable the Copilot');
});

test('the setup card offers the Claude CLI sign-in option', () => {
  expect(container.textContent).toContain('Or sign in with the Claude CLI (claude auth login) and restart the backend (development only).');
});

test('provider cli shows the local CLI line once the status reports it', async () => {
  expect(container.textContent).not.toContain('Using your Claude account via the local CLI (dev only)');
  axios.get.mockResolvedValueOnce({ data: { configured: true, model: 'claude-sonnet-5-5', provider: 'cli' } });
  await act(async () => { button('Check again').click(); });
  expect(container.textContent).toContain('Using your Claude account via the local CLI (dev only)');
  expect(container.textContent).not.toContain('Connect Claude to enable the Copilot');
});
