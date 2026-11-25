import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import useUserStore from '../store/userStore';
import useStrategyStore from '../store/strategyStore';
import { API, authed, errText, errStatus } from './api';

const PALETTE = ['#22d3ee', '#fbbf24', '#a78bfa', '#f472b6', '#60a5fa', '#fb923c'];
export const THROTTLE_MS = 30000; // new-candle re-evaluation, and how long a per symbol+interval result is reused
export const DEBOUNCE_MS = 300; // timeframe switching: only the timeframe the user settles on is evaluated

// Applied AI strategy -> chart overlays/markers/chip for the CURRENT chart ({kind, symbol, interval, candles}).
// all-timeframes (default): the same spec is evaluated on whatever interval the chart is on (debounced, in-flight
// request aborted, results cached 30 s per symbol+interval). Pinned: drawn only when the chart is on the pin.
// Nothing is drawn unless symbol and kind match (and, when pinned, the interval). A new candle re-runs the evaluation, at most once per 30 s.
export default function useStrategyOverlay({ kind, symbol, interval, candles }) {
  const active = useStrategyStore((s) => s.active);
  const token = useUserStore((s) => s.token);
  const [live, setLive] = useState(null); // { for: active, key, result }
  const [state, setState] = useState({ loading: false, error: null, unavailable: false });
  const lastRun = useRef(0);
  const seen = useRef(null); // last candle time already accounted for
  const seenKey = useRef(null);
  const timer = useRef(null);
  const ctl = useRef(null); // in-flight evaluate
  const cache = useRef(new Map()); // key -> { result, at }

  const all = !!active && active.allTimeframes !== false;
  const key = `${kind}|${symbol}|${interval}`;
  const match = !!active && active.kind === kind && active.symbol === symbol && (all || active.interval === interval);
  const initKey = active ? `${active.kind}|${active.symbol}|${active.resultInterval || active.interval}` : null;
  const lastTime = candles?.length ? candles[candles.length - 1].time : null;

  useEffect(() => { // new/changed strategy: its result is fresh, start the windows from now
    lastRun.current = Date.now();
    seen.current = null;
    cache.current = new Map();
    if (active?.result) cache.current.set(initKey, { result: active.result, at: Date.now() });
    setLive(null);
    setState({ loading: false, error: null, unavailable: false });
    return () => { clearTimeout(timer.current); if (ctl.current) ctl.current.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initKey derives from active
  }, [active]);

  const run = (k) => {
    lastRun.current = Date.now();
    setState({ loading: true, error: null, unavailable: false });
    if (ctl.current) ctl.current.abort();
    const c = new AbortController();
    ctl.current = c;
    axios.post(`${API}/api/strategies/evaluate`, { spec: active.spec, kind, symbol, interval }, { ...authed(token), signal: c.signal })
      .then((r) => { if (c.signal.aborted) return; cache.current.set(k, { result: r.data, at: Date.now() }); setLive({ for: active, key: k, result: r.data }); setState({ loading: false, error: null, unavailable: false }); })
      .catch((e) => { if (!c.signal.aborted) setState({ loading: false, error: errStatus(e) === 400 ? null : errText(e), unavailable: errStatus(e) === 400 }); });
  };

  // all-timeframes: a chart symbol/timeframe change needs a result for that key
  useEffect(() => {
    if (!match || !all) return undefined;
    const hit = cache.current.get(key);
    if (hit && Date.now() - hit.at < THROTTLE_MS) { setLive({ for: active, key, result: hit.result }); setState({ loading: false, error: null, unavailable: false }); return undefined; }
    setState({ loading: true, error: null, unavailable: false });
    timer.current = setTimeout(() => run(key), DEBOUNCE_MS);
    return () => { clearTimeout(timer.current); if (ctl.current) ctl.current.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run closes over the same inputs
  }, [match, all, active, key, token]);

  // a new candle (the previous one closed) re-runs the current key, throttled
  useEffect(() => {
    if (!match || lastTime == null) return undefined;
    if (seen.current == null || seenKey.current !== key) { seen.current = lastTime; seenKey.current = key; return undefined; }
    if (seen.current === lastTime) return undefined;
    seen.current = lastTime;
    clearTimeout(timer.current);
    const wait = THROTTLE_MS - (Date.now() - lastRun.current);
    if (wait <= 0) run(key); else timer.current = setTimeout(() => run(key), wait);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run closes over the same inputs
  }, [match, lastTime, active, key, token]);

  const result = !match ? null : live?.for === active && live.key === key ? live.result : key === initKey ? active.result : null;
  const { overlays, markers } = useMemo(() => ({
    overlays: Object.entries(result?.series || {}).map(([id, data], i) => ({ id, color: PALETTE[i % PALETTE.length], data })),
    markers: result?.markers || [],
  }), [result]);

  if (!active) return { overlays: undefined, markers: undefined, chip: null, ...state };
  const name = active.spec?.name || 'Strategy';
  const base = { name, mode: all ? 'all' : 'pinned', designedOn: active.interval, interval };
  const chip = match
    ? { ...base, trades: result?.stats?.trades ?? 0, winRate: result?.stats?.winRate ?? null, pending: !result, loading: state.loading, error: state.error, unavailable: state.unavailable }
    : { ...base, mismatch: active.kind === kind && active.symbol === symbol
      ? `Not drawn on ${interval}: pinned to ${active.interval}. Switch the chart to ${active.interval}, or apply on all timeframes.`
      : `Not drawn: strategy is for ${active.symbol}. Switch the chart to that symbol to see it.` };
  return { overlays: match && result ? overlays : undefined, markers: match && result ? markers : undefined, chip, ...state };
}
