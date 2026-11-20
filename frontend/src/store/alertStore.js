import { create } from 'zustand';
import axios from 'axios';
import { API, authed, errText } from '../lib/api';
import { getAlertsSocket } from '../lib/socket';
import useUserStore from './userStore';

let tid = 0;

// Short beep via WebAudio; a no-op where audio is unavailable (or blocked before a user gesture).
const playBeep = () => {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => ctx.close();
  } catch {
    // no audio support: stay silent
  }
};

const useAlertStore = create((set, get) => ({
  alerts: [],
  events: [],
  loaded: false,
  error: null,
  unread: 0,
  toasts: [],

  load: async (token) => {
    try {
      const [a, e] = await Promise.all([
        axios.get(`${API}/api/alerts`, authed(token)),
        axios.get(`${API}/api/alerts/events?limit=50`, authed(token)),
      ]);
      set({ alerts: Array.isArray(a.data) ? a.data : [], events: Array.isArray(e.data) ? e.data : [], loaded: true, error: null });
    } catch (err) {
      set({ loaded: true, error: errText(err) });
    }
  },

  // Mutations throw on failure so the caller can show the server message.
  create: async (token, body) => {
    const r = await axios.post(`${API}/api/alerts`, body, authed(token));
    set((s) => ({ alerts: [r.data, ...s.alerts] }));
  },
  patch: async (token, id, body) => {
    const r = await axios.patch(`${API}/api/alerts/${id}`, body, authed(token));
    set((s) => ({ alerts: s.alerts.map((a) => (a._id === id ? { ...a, ...body, ...(r.data || {}) } : a)) }));
  },
  remove: async (token, id) => {
    await axios.delete(`${API}/api/alerts/${id}`, authed(token));
    set((s) => ({ alerts: s.alerts.filter((a) => a._id !== id) }));
  },

  clearUnread: () => set({ unread: 0 }),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // Subscribe to live triggers; returns cleanup. Call once while a user is logged in.
  connect: (token) => {
    const socket = getAlertsSocket(token);
    const timers = new Set();
    const onTrig = (p) => {
      if (!p) return;
      // Preferences come from Settings (user.preferences); missing means the defaults: toasts on, sound off.
      const prefs = useUserStore.getState().user?.preferences || {};
      if (prefs.alertSound === true) playBeep();
      const toast = prefs.alertToasts !== false;
      const id = ++tid;
      set((s) => ({
        unread: s.unread + 1,
        toasts: toast ? [...s.toasts, { id, ...p }].slice(-3) : s.toasts,
        events: [{ _id: `live-${id}`, ...p }, ...s.events].slice(0, 50),
      }));
      if (!toast) return;
      const t = setTimeout(() => { timers.delete(t); get().dismissToast(id); }, 8000);
      timers.add(t);
    };
    socket.on('alert:triggered', onTrig);
    socket.connect();
    return () => {
      timers.forEach(clearTimeout);
      socket.off('alert:triggered', onTrig);
      socket.disconnect();
      set({ toasts: [], unread: 0, alerts: [], events: [], loaded: false });
    };
  },
}));

export default useAlertStore;
