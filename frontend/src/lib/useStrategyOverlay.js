import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import useUserStore from '../store/userStore';
import useStrategyStore from '../store/strategyStore';
import { API, authed, errText } from './api';

const PALETTE = ['#22d3ee', '#fbbf24', '#a78bfa', '#f472b6', '#60a5fa', '#fb923c'];
export const THROTTLE_MS = 30000;

// Active AI strategy -> chart overlays/markers/chip for the CURRENT chart ({kind, symbol, interval, candles}).
// Nothing is drawn unless symbol, kind and interval all match. The dock supplies the first result; after that a
// new candle (last candle time changes = the previous one closed) re-runs the server evaluation, at most once per 30 s.
export default function useStrategyOverlay({ kind, symbol, interval, candles }) {
  const active = useStrategyStore((s) => s.active);
  const token = useUserStore((s) => s.token);
  const [live, setLive] = useState(null); // { for: active, result }
  const [state, setState] = useState({ loading: false, error: null });
  const lastRun = useRef(0);
  const seen = useRef(null); // last candle time already accounted for
  const timer = useRef(null);
  const ctl = useRef(null); // in-flight evaluate; aborted when the strategy changes or the chart unmounts

  const match = !!active && active.kind === kind && active.symbol === symbol && active.interval === interval;
  const lastTime = candles?.length ? candles[candles.length - 1].time : null;

  useEffect(() => { // new strategy: its result is fresh, start the throttle window and candle watch from now
    lastRun.current = Date.now();
    seen.current = null;
    setLive(null);
    setState({ loading: false, error: null });
    return () => { clearTimeout(timer.current); if (ctl.current) ctl.current.abort(); };
  }, [active]);

  useEffect(() => {
    if (!match || lastTime == null) return undefined;
    if (seen.current == null) { seen.current = lastTime; return undefined; }
    if (seen.current === lastTime) return undefined;
    seen.current = lastTime;
    const run = () => {
      lastRun.current = Date.now();
      setState({ loading: true, error: null });
      const body = { spec: active.spec, kind, symbol, interval };
      if (ctl.current) ctl.current.abort();
      const c = new AbortController();
      ctl.current = c;
      axios.post(`${API}/api/strategies/evaluate`, body, { ...authed(token), signal: c.signal })
        .then((r) => { if (c.signal.aborted) return; setLive({ for: active, result: r.data }); setState({ loading: false, error: null }); })
        .catch((e) => { if (!c.signal.aborted) setState({ loading: false, error: errText(e) }); });
    };
    clearTimeout(timer.current);
    const wait = THROTTLE_MS - (Date.now() - lastRun.current);
    if (wait <= 0) run(); else timer.current = setTimeout(run, wait);
    return undefined;
  }, [match, lastTime, active, kind, symbol, interval, token]);

  const result = match ? (live?.for === active ? live.result : active.result) : null;
  const { overlays, markers } = useMemo(() => ({
    overlays: Object.entries(result?.series || {}).map(([id, data], i) => ({ id, color: PALETTE[i % PALETTE.length], data })),
    markers: result?.markers || [],
  }), [result]);

  if (!active) return { overlays: undefined, markers: undefined, chip: null, ...state };
  const name = active.spec?.name || 'Strategy';
  const chip = match
    ? { name, trades: result?.stats?.trades ?? 0, winRate: result?.stats?.winRate ?? null, loading: state.loading, error: state.error }
    : { name, mismatch: `Not drawn: strategy is for ${active.symbol} ${active.interval}. Switch the chart to that symbol and timeframe to see it.` };
  return { overlays: match ? overlays : undefined, markers: match ? markers : undefined, chip, ...state };
}
