import { create } from 'zustand';
import axios from 'axios';
import { getFuturesSocket } from '../lib/socket';
import { INTERVAL_SEC, foldTick } from '../components/trade/candleSync';

const API = process.env.REACT_APP_API_URL || '';
const MAX_CANDLES = 1500;
const MAX_LIQ = 2000; // client-side cap (the backend per-symbol buffer holds up to 5000; we keep the newest 2000)
const MAX_TRADES = 60;

const empty = { candles: [], book: null, mark: null, trades: [], liquidations: [], since: null, error: null, interval: '1m', reloadSeq: 0 };

const mergeCandles = (a, b) => {
  const byTime = new Map();
  [...a, ...b].forEach((c) => byTime.set(c.time, c));
  return [...byTime.values()].sort((x, y) => x.time - y.time).slice(-MAX_CANDLES);
};

const liqKey = (e) => `${e.ts}|${e.price}|${e.qty}|${e.side}`;

let wired = false;
let reloading = null; // 'SYMBOL|interval' of the in-flight REST kline load, so tick bursts don't stack requests

const useFuturesStore = create((set, get) => {
  // Only apply messages for the symbol currently shown
  const forCurrent = (fn) => (msg) => {
    if (msg && msg.symbol === get().symbol) fn(msg);
  };

  const wire = (socket) => {
    if (wired) return;
    wired = true;
    let hasConnected = !!socket.connected; // the first connect is covered by subscribe(); only a REconnect needs a backfill
    socket.on('connect', () => {
      const first = !hasConnected;
      hasConnected = true;
      if (first) return;
      const { symbol, error } = get();
      if (!symbol) return;
      if (error === 'load_failed') get().subscribe(symbol, get().interval); // retry the REST load
      else if (!error) {
        socket.emit('futures:subscribe', { symbol }); // resubscribe after reconnect
        get().reloadKlines(); // backfill candles missed while offline
      }
    });
    socket.on('futures:error', () => {
      if (get().symbol) set({ error: 'load_failed' }); // refused subscription: surface the Retry state
    });
    socket.on('futures:kline', forCurrent((k) => {
      const { symbol: _s, ...tick } = k;
      const { interval, candles } = get();
      if (interval === '1m') return set({ candles: mergeCandles(candles, [tick]) });
      // ponytail: the socket only streams 1m, so live volume on higher timeframes lags until the next REST refetch
      const r = foldTick(candles, tick, INTERVAL_SEC[interval]);
      if (r.refetch) get().reloadKlines();
      else set({ candles: r.candles });
    }));
    socket.on('futures:trades', forCurrent((m) => {
      if (!Array.isArray(m.trades)) return;
      // batches arrive oldest-first; the tape shows newest on top
      set((s) => ({ trades: [...m.trades].reverse().concat(s.trades).slice(0, MAX_TRADES) }));
    }));
    socket.on('futures:book', forCurrent((b) => set({ book: b })));
    socket.on('futures:mark', forCurrent((m) => set({ mark: m })));
    socket.on('futures:liquidation', forCurrent((e) =>
      set((s) => ({ liquidations: [...s.liquidations, e].slice(-MAX_LIQ) }))
    ));
  };

  return {
    symbol: null, // e.g. 'BTCUSDT'
    ...empty,

    // interval: the timeframe to open with (the user's default); defaults to 1m.
    subscribe: async (symbol, interval = '1m') => {
      if (get().symbol === symbol && get().error !== 'load_failed') return;
      const socket = getFuturesSocket();
      wire(socket);
      const prev = get().symbol;
      if (prev) socket.emit('futures:unsubscribe', { symbol: prev });
      set({ symbol, ...empty, interval });

      try {
        const [k, l] = await Promise.all([
          axios.get(`${API}/api/market/futures/klines/${symbol}`, { params: { interval, limit: 500 } }),
          axios.get(`${API}/api/market/futures/liquidations/${symbol}`),
        ]);
        if (get().symbol !== symbol) return; // user moved on
        const seen = new Set(get().liquidations.map(liqKey));
        const seeded = l.data.events.filter((e) => !seen.has(liqKey(e)));
        set((s) => ({
          ...(s.interval === interval ? { candles: mergeCandles(k.data, s.candles), reloadSeq: s.reloadSeq + 1 } : {}),
          liquidations: [...seeded, ...s.liquidations].slice(-MAX_LIQ),
          since: l.data.since,
        }));
        socket.emit('futures:subscribe', { symbol });
      } catch (err) {
        if (get().symbol !== symbol) return;
        set({ error: err.response?.status === 404 ? 'no_market' : 'load_failed' });
      }
    },

    // Re-read candles for the current symbol/interval; REST is authoritative so it replaces the series.
    reloadKlines: async () => {
      const { symbol, interval } = get();
      const key = `${symbol}|${interval}`;
      if (!symbol || reloading === key) return;
      reloading = key;
      try {
        const { data } = await axios.get(`${API}/api/market/futures/klines/${symbol}`, { params: { interval, limit: 500 } });
        if (get().symbol === symbol && get().interval === interval) {
          set((s) => ({ candles: data.slice(-MAX_CANDLES), error: null, reloadSeq: s.reloadSeq + 1 }));
        }
      } catch (err) {
        if (get().symbol === symbol && get().interval === interval && get().candles.length === 0) set({ error: 'load_failed' });
      } finally {
        if (reloading === key) reloading = null;
      }
    },

    setTimeframe: (interval) => {
      if (!get().symbol || interval === get().interval || get().error === 'no_market') return;
      set({ interval, candles: [] }); // clear first so another timeframe's candles are never shown
      get().reloadKlines();
    },

    unsubscribe: () => {
      const { symbol } = get();
      if (symbol) getFuturesSocket().emit('futures:unsubscribe', { symbol });
      set({ symbol: null, ...empty });
    },
  };
});

export default useFuturesStore;
