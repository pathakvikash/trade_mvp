import { io } from 'socket.io-client';

let socket = null;

export function getMarketSocket() {
  if (!socket) {
    const host = process.env.REACT_APP_API_HOST || window.location.origin.replace(/:\d+$/, ':4000');
    const url = host;
    socket = io(`${url}/market`, {
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}
