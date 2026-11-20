import { useCallback, useEffect, useRef, useState } from 'react';
import useUserStore from '../store/userStore';

// useState that survives navigation and reloads. Stored as JSON under tm:v1:<userId|anon>:<key>.
// Stale or corrupt values fail `validate` and fall back to `initial`; blocked storage just means no persistence.
const SAME_TAB = 'tm:persist'; // the 'storage' event only fires in OTHER tabs, so same-tab instances sync through this

const userId = (u) => u?._id || u?.id || 'anon';
export const persistKey = (key, uid = userId(useUserStore.getState().user)) => `tm:v1:${uid}:${key}`;

export function readPersisted(key, initial, validate, uid) {
  try {
    const raw = localStorage.getItem(persistKey(key, uid));
    if (raw === null) return initial;
    const v = JSON.parse(raw);
    return !validate || validate(v) ? v : initial;
  } catch {
    return initial;
  }
}

export function writePersisted(key, value, uid) {
  try {
    localStorage.setItem(persistKey(key, uid), JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(SAME_TAB, { detail: persistKey(key, uid) }));
  } catch { /* storage blocked or full: the choice just isn't remembered */ }
}

export const oneOf = (...allowed) => (v) => allowed.includes(v);

export default function usePersistedState(key, initial, { validate } = {}) {
  const uid = userId(useUserStore((s) => s.user));
  const opts = useRef({ initial, validate });
  opts.current = { initial, validate };
  const read = useCallback(() => readPersisted(key, opts.current.initial, opts.current.validate, uid), [key, uid]);

  const [state, setState] = useState(() => ({ id: `${uid}:${key}`, value: read() }));
  // key/user changed (login, logout): re-read synchronously during render so we never show the old user's value
  let cur = state;
  if (state.id !== `${uid}:${key}`) {
    cur = { id: `${uid}:${key}`, value: read() };
    setState(cur);
  }
  const valueRef = useRef(cur.value);
  valueRef.current = cur.value;

  useEffect(() => {
    const full = persistKey(key, uid);
    const sync = (e) => {
      if ((e.type === 'storage' ? e.key !== full && e.key !== null : e.detail !== full)) return;
      const value = read();
      setState((s) => (Object.is(s.value, value) || JSON.stringify(s.value) === JSON.stringify(value) ? s : { id: s.id, value }));
    };
    window.addEventListener('storage', sync);
    window.addEventListener(SAME_TAB, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(SAME_TAB, sync);
    };
  }, [key, uid, read]);

  const keyRef = useRef({ key, uid });
  keyRef.current = { key, uid };
  const set = useCallback((next) => {
    const v = typeof next === 'function' ? next(valueRef.current) : next;
    valueRef.current = v;
    setState((s) => ({ id: s.id, value: v }));
    writePersisted(keyRef.current.key, v, keyRef.current.uid);
  }, []);

  return [cur.value, set];
}

export { usePersistedState };
