import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import usePersistedState, { oneOf, readPersisted, writePersisted } from './usePersistedState';
import useUserStore from '../store/userStore';

let container;
let root;
let hooks;
const Probe = ({ id, k = 'k', init = 'a', validate }) => {
  const [v, set] = usePersistedState(k, init, { validate });
  hooks[id] = { v, set };
  return null;
};
const mount = (...els) => act(() => { root.render(<>{els.map((e, i) => React.cloneElement(e, { key: i }))}</>); });

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear();
  useUserStore.setState({ user: null });
  hooks = {};
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); jest.restoreAllMocks(); });

test('persists across remount under a namespaced key', () => {
  mount(<Probe id="x" />);
  act(() => hooks.x.set('b'));
  expect(localStorage.getItem('tm:v1:anon:k')).toBe('"b"');
  act(() => root.unmount());
  root = createRoot(container);
  mount(<Probe id="x" />);
  expect(hooks.x.v).toBe('b');
});

test('corrupt JSON falls back to initial', () => {
  localStorage.setItem('tm:v1:anon:k', '{nope');
  mount(<Probe id="x" />);
  expect(hooks.x.v).toBe('a');
});

test('failed validate falls back to initial', () => {
  localStorage.setItem('tm:v1:anon:k', '"zzz"');
  mount(<Probe id="x" validate={oneOf('a', 'b')} />);
  expect(hooks.x.v).toBe('a');
});

test('throwing storage does not break rendering or setting', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  mount(<Probe id="x" />);
  expect(hooks.x.v).toBe('a');
  act(() => hooks.x.set('b'));
  expect(hooks.x.v).toBe('b');
});

test('namespaced per user', () => {
  mount(<Probe id="x" />);
  act(() => hooks.x.set('b'));
  act(() => useUserStore.setState({ user: { _id: 'u1' } }));
  expect(hooks.x.v).toBe('a');
  act(() => hooks.x.set('c'));
  expect(localStorage.getItem('tm:v1:u1:k')).toBe('"c"');
  act(() => useUserStore.setState({ user: null }));
  expect(hooks.x.v).toBe('b');
});

test('instances with the same key stay in sync, setter is stable, functional updates work', () => {
  mount(<Probe id="x" />, <Probe id="y" />);
  const first = hooks.x.set;
  act(() => hooks.x.set('b'));
  expect(hooks.y.v).toBe('b');
  act(() => hooks.y.set((p) => p + '!'));
  expect(hooks.x.v).toBe('b!');
  expect(hooks.x.set).toBe(first);
});

test('storage event from another tab updates the value', () => {
  mount(<Probe id="x" />);
  localStorage.setItem('tm:v1:anon:k', '"z"');
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'tm:v1:anon:k', newValue: '"z"' })); });
  expect(hooks.x.v).toBe('z');
});

test('readPersisted / writePersisted for non-hook code', () => {
  expect(readPersisted('n', 1)).toBe(1);
  writePersisted('n', 5);
  expect(readPersisted('n', 1)).toBe(5);
  expect(readPersisted('n', 1, (v) => v < 3)).toBe(1);
});
