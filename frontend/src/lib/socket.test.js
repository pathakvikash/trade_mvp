import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { useSocketStatus } from './socket';

jest.mock('socket.io-client', () => ({ io: jest.fn() }));

const fake = () => {
  const h = {};
  const mgr = {};
  const mk = (t) => ({
    on: (e, f) => { (t[e] = t[e] || []).push(f); },
    off: (e, f) => { t[e] = (t[e] || []).filter((x) => x !== f); },
  });
  const s = { connected: false, active: true, ...mk(h), io: mk(mgr) };
  s.emit = (e) => (h[e] || []).forEach((f) => f());
  s.emitIo = (e) => (mgr[e] || []).forEach((f) => f());
  s.count = () => Object.values(h).flat().length + Object.values(mgr).flat().length;
  return s;
};

global.IS_REACT_ACT_ENVIRONMENT = true;

test('useSocketStatus follows connect / disconnect / reconnect_attempt and cleans up', () => {
  const s = fake();
  let seen;
  const C = () => { seen = useSocketStatus(s); return null; };
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<C />));
  expect(seen).toBe('connecting');
  s.connected = true; act(() => s.emit('connect'));
  expect(seen).toBe('connected');
  s.connected = false; act(() => s.emit('disconnect'));
  expect(seen).toBe('connecting');
  act(() => s.emitIo('reconnect_attempt'));
  expect(seen).toBe('connecting');
  s.active = false; act(() => s.emit('disconnect'));
  expect(seen).toBe('disconnected');
  act(() => root.unmount());
  expect(s.count()).toBe(0);
});
