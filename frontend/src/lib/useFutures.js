import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import usePolling from './usePolling';
import { API, authed, errText } from './api';

// Futures data for the signed-in user (docs/phase2-leverage.md §5). positions and orders poll every 3 s with the Bearer
// token; config is fetched once per token. reload() refetches config now and both lists immediately (call after a
// futures order, close or TP/SL edit). Polling pauses while the tab is hidden (usePolling).
const POLL_MS = 3000;

export default function useFutures(token) {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const positions = usePolling(token ? `${API}/api/futures/positions` : null, POLL_MS, refreshKey, token);
  const orders = usePolling(token ? `${API}/api/futures/orders` : null, POLL_MS, refreshKey, token);

  const loadConfig = useCallback(async () => {
    if (!token) return;
    try {
      const r = await axios.get(`${API}/api/futures/config`, authed(token));
      setConfig(r.data);
      setConfigError(null);
    } catch (e) {
      setConfigError(errText(e));
    }
  }, [token]);

  useEffect(() => {
    setConfig(null);
    loadConfig();
  }, [loadConfig]);

  const reload = useCallback(() => {
    loadConfig();
    setRefreshKey((k) => k + 1);
  }, [loadConfig]);

  return {
    config,
    configError,
    positions: positions.data?.positions ?? [],
    closedPositions: positions.data?.closed ?? [],
    orders: orders.data?.orders ?? [],
    closedOrders: orders.data?.closed ?? [],
    loading: !!token && (positions.loading || orders.loading || (!config && !configError)),
    error: positions.error || orders.error ? errText(positions.error || orders.error) : null,
    reload,
  };
}
