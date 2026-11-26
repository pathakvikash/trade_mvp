import { useCallback, useEffect, useState } from 'react';
import { hasEscLayer } from './escLayers';

// CSS-only maximise: the SAME panel node gets fixed classes, so the chart inside is never remounted
// (zoom, series and crosshair survive; lightweight-charts autoSize refits). No portal.
// Route changes unmount the page, so the effect cleanup is the "auto-off on navigation".
// `!` modifiers beat the panel's own responsive height classes. Backdrop is z-40; a dock at z-50 sits above.
export const MAX_CLASS = '!fixed !inset-0 sm:!inset-2 !z-40 !h-auto !min-h-0 !bg-slate-950 shadow-2xl';

// Panels maximised right now: <html> scroll is locked while any is, and restored to '' only when the last one exits
// (per-hook "restore the previous value" left it stuck at 'hidden' when two exited out of order).
let locked = 0;

const useMaximize = () => {
  const [max, setMax] = useState(false);
  const exit = useCallback(() => setMax(false), []);
  const toggle = useCallback(() => setMax((m) => !m), []);

  useEffect(() => {
    if (!max) return undefined;
    const onKey = (e) => e.key === 'Escape' && !hasEscLayer() && setMax(false);
    document.addEventListener('keydown', onKey);
    const html = document.documentElement;
    locked += 1;
    html.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      locked -= 1;
      if (locked === 0) html.style.overflow = '';
    };
  }, [max]);

  // spread on <Panel>: className is appended, role/aria only while maximised
  return { max, toggle, exit, panelClass: max ? MAX_CLASS : '', panelProps: max ? { role: 'region', 'aria-label': 'Maximised chart' } : {} };
};

export default useMaximize;
