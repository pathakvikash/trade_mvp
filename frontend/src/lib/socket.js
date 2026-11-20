import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const sockets = {};

function getSocket(namespace, opts = {}) {
  if (!sockets[namespace]) {
    const host = (process.env.REACT_APP_API_URL || '').replace(/\/+$/, '') || window.location.origin.replace(/:\d+$/, ':4000');
    sockets[namespace] = io(`${host}${namespace}`, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
      ...opts,
    });
  }
  return sockets[namespace];
}

export const getMarketSocket = () => getSocket('/market');
export const getFuturesSocket = () => getSocket('/futures');

// Authenticated namespace: caller connect()s / disconnect()s.
// It gets its own Manager (forceNew): on the shared, auto-connecting Manager a new namespace
// socket connects by itself on creation, before the token is set and again on connect(),
// which either gets it rejected or joins the user's room several times (duplicate toasts).
let alertsToken = null;
export const getAlertsSocket = (token) => {
  alertsToken = token;
  return getSocket('/alerts', {
    forceNew: true,
    autoConnect: false,
    auth: (cb) => cb({ token: alertsToken }),
  });
};

// 'connected' | 'connecting' (first connect or auto-retrying) | 'disconnected' (gave up / closed on purpose)
export function useSocketStatus(socket) {
  const [status, setStatus] = useState(() => {
    const s = socket || getMarketSocket();
    return s.connected ? 'connected' : 'connecting';
  });
  useEffect(() => {
    const s = socket || getMarketSocket();
    const retry = () => setStatus(s.active === false ? 'disconnected' : 'connecting');
    const up = () => setStatus('connected');
    setStatus(s.connected ? 'connected' : 'connecting');
    s.on('connect', up);
    s.on('disconnect', retry);
    s.on('connect_error', retry);
    s.io.on('reconnect_attempt', retry);
    return () => {
      s.off('connect', up);
      s.off('disconnect', retry);
      s.off('connect_error', retry);
      s.io.off('reconnect_attempt', retry);
    };
  }, [socket]);
  return status;
}
