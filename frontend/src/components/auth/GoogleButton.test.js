import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import axios from 'axios';
import GoogleButton from './GoogleButton';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
// react-router-dom 7 points "main" at a missing file, and Jest 27 (CRA) ignores "exports". This test only needs useNavigate.
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }), { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

test('not configured: disabled button with the setup note, and the Google script is never loaded', async () => {
  axios.get.mockResolvedValue({ data: { googleClientId: null } });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<GoogleButton />);
  });

  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/api\/auth\/config$/));
  const button = container.querySelector('button');
  expect(button.textContent).toBe('Continue with Google');
  expect(button.disabled).toBe(true);
  expect(container.textContent).toContain('Not configured: set GOOGLE_CLIENT_ID in backend/.env');
  expect(document.querySelector('script[src*="accounts.google.com"]')).toBeNull();

  act(() => root.unmount());
  container.remove();
});
