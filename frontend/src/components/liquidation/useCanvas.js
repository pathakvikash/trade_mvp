import { useCallback, useEffect, useRef } from 'react';

// DPR-aware canvas that repaints when `draw(ctx, width, height)` changes or its container resizes.
// Attach `wrap` to the container (position: relative) and `canvas` to the <canvas>.
export default function useCanvas(draw, height) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const paint = useCallback(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    const W = w.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * dpr);
    c.height = Math.round(height * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${height}px`;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, W, height);
  }, [draw, height]);
  useEffect(() => {
    // the container is absent while a loading/empty state is shown; the effect
    // re-runs when `draw` changes with the data, by which time it is mounted
    if (!wrap.current) return undefined;
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [paint]);
  return { wrap, canvas };
}
