import axios from 'axios';
import useUserStore from '../store/userStore';
import { API } from './apiBase';

// Backend base URL (no trailing slash). Empty = same origin (e.g. behind a proxy/rewrite).
export { API };
export const authed = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
export const errStatus = (e) => e?.response?.status;
export const errText = (e) => (errStatus(e) === 401 ? 'Session expired, sign in again.' : null) || (errStatus(e) === 429 ? 'Too many requests, slow down.' : null) || e?.response?.data?.error || e?.response?.data?.reason || e?.message || 'Request failed';

// Login/register/password answer 401/422 for bad input (password: wrong current password); those are not an expired session.
const PUBLIC_AUTH = [`${API}/api/auth/login`, `${API}/api/auth/register`, `${API}/api/auth/password`];
const isOurs = (url) => typeof url === 'string' && url.startsWith(`${API}/api/`) && !PUBLIC_AUTH.some((p) => url.startsWith(p));

// The ONE place a 401 from our API ends the session: clear the store, go to /login. Installed once from index.js
// (not at import, so tests that mock axios are unaffected). Every authed call goes through the default axios instance.
export function installAuthInterceptor() {
  const id = axios.interceptors.response.use(
    (r) => r,
    (e) => {
      const dead = ['Invalid token', 'No token provided'].includes(e?.response?.data?.message); // expired session even on a public-auth URL
      if (errStatus(e) === 401 && (isOurs(e.config?.url) || dead)) {
        useUserStore.getState().setLogout();
        if (!['/login', '/register'].includes(window.location.pathname)) window.location.assign('/login');
      }
      return Promise.reject(e);
    },
  );
  return () => axios.interceptors.response.eject(id);
}

// Verifies the persisted token with the server once per token per page load. A 401 is handled by the interceptor
// (-> false); other failures (API down) resolve true so the app still renders and its own calls report errors.
let verified = { token: null, p: null };
export function verifySession(token) {
  if (verified.token !== token) {
    verified = { token, p: axios.get(`${API}/api/auth/verify`, authed(token)).then(() => true, (e) => errStatus(e) !== 401) };
  }
  return verified.p;
}
