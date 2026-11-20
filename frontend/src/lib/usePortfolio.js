import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API, authed, errText } from './api';

// The signed-in user's paper balance, net holdings and latest trades. reload() refetches (call after an order).
export default function usePortfolio(token) {
  const [state, setState] = useState({ balance: null, holdings: [], trades: [], error: null, loading: !!token });
  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const [p, t] = await Promise.all([
        axios.get(`${API}/api/trades/portfolio`, authed(token)),
        axios.get(`${API}/api/trades?limit=100`, authed(token)),
      ]);
      setState({ balance: p.data.balance, holdings: p.data.holdings, trades: t.data.trades, error: null, loading: false });
    } catch (e) {
      setState((s) => ({ ...s, error: errText(e), loading: false }));
    }
  }, [token]);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}
