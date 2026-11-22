import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import usePolling from './usePolling';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), isCancel: () => false } }));

let out;
const Probe = () => { out = usePolling('/x', 60000); return null; };

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

const run = async (headers) => {
  axios.get.mockResolvedValue({ data: [1], headers });
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe />); });
  act(() => root.unmount());
};

test('exposes the X-Data-Source header as source', async () => {
  await run({ 'x-data-source': 'ws' });
  expect(out.source).toBe('ws');
  expect(out.data).toEqual([1]);
});

test('source is null when the header is absent', async () => {
  await run({});
  expect(out.source).toBeNull();
});
