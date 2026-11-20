import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

// GET `url` now and every `ms`; pauses while the tab is hidden; aborts on unmount/url change.
// Pass a falsy url to idle. Keeps the last good data when a refresh fails.
// Optional refreshKey: changing it refetches now WITHOUT clearing the data; `fetching` is then true while in flight.
export default function usePolling(url, ms, refreshKey) {
  const [state, setState] = useState({ data: null, error: null, loading: !!url });
  const lastUrl = useRef(null);

  useEffect(() => {
    if (!url) {
      lastUrl.current = null;
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    if (lastUrl.current !== url) setState({ data: null, error: null, loading: true });
    lastUrl.current = url;
    let ctl;
    const run = async () => {
      if (document.hidden) return;
      if (ctl) ctl.abort();
      ctl = new AbortController();
      if (refreshKey) setState((s) => ({ ...s, fetching: true }));
      try {
        const r = await axios.get(url, { signal: ctl.signal });
        setState({ data: r.data, error: null, loading: false, fetching: false });
      } catch (e) {
        if (axios.isCancel(e)) return;
        setState((s) => ({ ...s, error: e, loading: false, fetching: false }));
      }
    };
    const onVis = () => { if (!document.hidden) run(); };
    run();
    const timer = setInterval(run, ms);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      if (ctl) ctl.abort();
    };
  }, [url, ms, refreshKey]);

  return state;
}
