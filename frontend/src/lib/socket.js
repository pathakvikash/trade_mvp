import { io } from 'socket.io-client';

const sockets = {};

function getSocket(namespace, opts = {}) {
  if (!sockets[namespace]) {
    const host = process.env.REACT_APP_API_HOST || window.location.origin.replace(/:\d+$/, ':4000');
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
