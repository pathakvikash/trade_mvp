import { create } from 'zustand';
import { getMarketSocket } from '../lib/socket';

const useMarketStore = create((set) => ({
  marketData: [],
  socketStatus: 'connecting', // 'connecting' | 'connected' | 'disconnected' | 'error'
  lastUpdate: 0,

  setMarketData: (data) => set({ marketData: data, lastUpdate: Date.now() }),
  setSocketStatus: (status) => set({ socketStatus: status }),

  initSocket: () => {
    const socket = getMarketSocket();

    const onConnect = () => set({ socketStatus: 'connected' });
    const onConnecting = () => set({ socketStatus: 'connecting' });
    const onDisconnect = () => set({ socketStatus: 'disconnected' });
    const onError = () => set({ socketStatus: 'error' });

    const handleUpdate = (payload) => {
      if (Array.isArray(payload)) {
        set({ marketData: payload, lastUpdate: Date.now() });
      }
    };

    socket.on('connect', onConnect);
    socket.on('reconnect_attempt', onConnecting);
    socket.on('connect_error', onError);
    socket.on('disconnect', onDisconnect);
    socket.on('market:update', handleUpdate);

    // Request an immediate sync when connected
    try {
      socket.emit('market:subscribe');
    } catch (e) {
      // ignore
    }

    // Return cleanup function to disconnect later
    return () => {
      socket.off('connect', onConnect);
      socket.off('reconnect_attempt', onConnecting);
      socket.off('connect_error', onError);
      socket.off('disconnect', onDisconnect);
      socket.off('market:update', handleUpdate);
    };
  },
}));

export default useMarketStore;
