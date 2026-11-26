import { useCallback, useEffect, useRef, useState } from 'react';
import { FULL, STEP, clampView, panBy, zoomAt } from './zoomView';

const DRAG_PX = 4; // movement before a press counts as a drag (below it, it is still a click)

// Zoom/pan state for a canvas chart whose pointer target is `ref` (the plot area; `pad` = space inside it taken by axes).
//  - Ctrl/Cmd+wheel and trackpad pinch (Chrome/Safari send those as ctrl+wheel) zoom at the pointer; a plain wheel is never
//    touched, so the page keeps scrolling.
//  - drag pans when zoomed; two-finger pinch/pan on touch (the element should be touch-action: pan-y so one finger still scrolls).
//  - zoomBy/reset for buttons, key() for +/-/0, resetKey changes (symbol/range) reset.
// Wheel/drag/pinch updates are coalesced into one state change per animation frame; buttons and keys apply at once.
export default function useZoomPan(ref, { axes = 'xy', pad = { l: 0, r: 0, t: 0, b: 0 }, resetKey, enabled = true } = {}) {
  const [view, setView] = useState(FULL);
  const cur = useRef(FULL);
  const raf = useRef(0);
  const dragged = useRef(false);
  const dragging = useRef(false);
  const pts = useRef(new Map()); // pointerId -> {x, y}
  const gesture = useRef(null);
  const padRef = useRef(pad);
  padRef.current = pad;

  const set = useCallback((v, now) => {
    cur.current = clampView(v, axes);
    if (now) { cancelAnimationFrame(raf.current); raf.current = 0; setView(cur.current); return; }
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; setView(cur.current); });
  }, [axes]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { set(FULL, true); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Plot-area fractions of a viewport point.
  const frac = useCallback((cx, cy) => {
    const b = ref.current.getBoundingClientRect();
    const p = padRef.current;
    const w = b.width - p.l - p.r;
    const h = b.height - p.t - p.b;
    return { fx: w > 0 ? (cx - b.left - p.l) / w : 0.5, fy: h > 0 ? (cy - b.top - p.t) / h : 0.5, w, h };
  }, [ref]);
  const inPlot = (f) => f.fx >= 0 && f.fx <= 1 && f.fy >= 0 && f.fy <= 1;

  const zoomBy = useCallback((factor, at, now = true) => {
    set(zoomAt(cur.current, factor, at?.fx ?? 0.5, at?.fy ?? 0.5, axes), now);
  }, [set, axes]);
  const reset = useCallback(() => set(FULL, true), [set]);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel: leave it to the page
      const f = frac(e.clientX, e.clientY);
      if (!inPlot(f)) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomBy(Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.01), f, false);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, enabled, frac, zoomBy]);

  const spread = () => { const [a, b] = [...pts.current.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragged.current = false;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    gesture.current = pts.current.size === 2 ? spread() : null;
    if (pts.current.size === 2) dragged.current = true; // a pinch is never a tap
  };
  // returns true when the event was part of a pan/pinch (the caller then skips hover)
  const move = (e) => {
    const p = pts.current.get(e.pointerId);
    if (!p) return false;
    const x = e.clientX;
    const y = e.clientY;
    if (pts.current.size === 2 && gesture.current) {
      pts.current.set(e.pointerId, { ...p, x, y });
      const g = spread();
      const f = frac(g.mx, g.my);
      let v = zoomAt(cur.current, g.d / gesture.current.d, f.fx, f.fy, axes);
      v = panBy(v, (g.mx - gesture.current.mx) / f.w, (g.my - gesture.current.my) / f.h, axes);
      gesture.current = g;
      set(v);
      return true;
    }
    const wasDrag = dragging.current;
    if (!wasDrag && Math.hypot(x - p.x0, y - p.y0) < DRAG_PX) return false;
    if (cur.current.k <= 1) return false; // nothing to pan
    if (!wasDrag) { dragging.current = true; dragged.current = true; try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ } }
    const f = frac(x, y);
    set(panBy(cur.current, (x - p.x) / f.w, e.pointerType === 'touch' ? 0 : (y - p.y) / f.h, axes)); // touch: vertical drag is the page's
    pts.current.set(e.pointerId, { ...p, x, y });
    return true;
  };
  const up = (e) => {
    pts.current.delete(e.pointerId);
    gesture.current = pts.current.size === 2 ? spread() : null;
    if (!pts.current.size) dragging.current = false;
  };
  // True once after a drag/pinch: a click that ends one must not also count as a tap or measure point.
  const wasDragged = () => { const d = dragged.current; dragged.current = false; return d; };

  // +/-/0 keys; true when handled.
  const key = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === '+' || e.key === '=') zoomBy(STEP);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / STEP);
    else if (e.key === '0') reset();
    else return false;
    e.preventDefault();
    return true;
  };

  return { view, setView: (v) => set(v, true), zoomBy, reset, key, frac, handlers: { down, move, up }, wasDragged, isDragging: () => dragging.current };
}
