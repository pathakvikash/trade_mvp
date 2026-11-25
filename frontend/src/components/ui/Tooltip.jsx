import React, { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscLayer } from './escLayers';

// Place a position:fixed `node` next to the trigger rect `r`: above (or below when there is no room, `prefer` flips
// that), centred and clamped to the viewport. Shared by tooltips and the Close menu.
export const placeFixed = (node, r, { gap = 6, prefer = 'above', align = 'center' } = {}) => {
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const above = r.top - gap - h;
  const below = r.bottom + gap;
  const fitsAbove = above >= 4;
  const fitsBelow = below + h <= vh - 4;
  const useAbove = prefer === 'above' ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;
  const top = useAbove ? Math.max(4, above) : Math.max(4, Math.min(below, vh - h - 4));
  const x = align === 'end' ? r.right - w : align === 'start' ? r.left : r.left + r.width / 2 - w / 2;
  node.style.left = `${Math.round(Math.min(Math.max(4, x), Math.max(4, vw - w - 4)))}px`;
  node.style.top = `${Math.round(top)}px`;
  node.style.visibility = 'visible';
};

// Close a floating layer on Esc (topmost only), on resize, and when a scroll moves its anchor (capture catches scrolling tables and
// panels too; live lists elsewhere on the page that scroll themselves are ignored).
export const useDismiss = (open, close, anchor) => {
  useEscLayer(open, close); // Esc closes only the topmost open layer
  useEffect(() => {
    if (!open) return undefined;
    const onScroll = (e) => { if (e.type === 'resize' || !anchor?.current || e.target.contains?.(anchor.current)) close(); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, close, anchor]);
};

const DELAY = 250; // ms of hover before a tooltip shows; keyboard focus shows at once

// Tooltip on hover AND keyboard focus. Rendered through a portal into document.body with position:fixed, so the
// overflow of scroll containers and the stacking contexts of sticky cells cannot clip or cover it.
// `describe` false: the text equals the trigger's aria-label, so aria-describedby would only repeat it.
export const useTip = (text, { describe = true } = {}) => {
  const id = useId();
  const [rect, setRect] = useState(null);
  const timer = useRef(null);
  const node = useRef(null);
  const trigger = useRef(null);
  const pressed = useRef(false); // a mouse/touch press also focuses the button: only keyboard focus shows the tip
  const hide = useRef(() => { clearTimeout(timer.current); setRect(null); }).current;
  useEffect(() => () => clearTimeout(timer.current), []);
  useDismiss(!!rect, hide, trigger);
  useLayoutEffect(() => { if (rect && node.current) placeFixed(node.current, rect); }, [rect]);
  const show = (e, wait) => {
    const t = e.currentTarget;
    trigger.current = t;
    clearTimeout(timer.current);
    if (wait) timer.current = setTimeout(() => setRect(t.getBoundingClientRect()), wait);
    else setRect(t.getBoundingClientRect());
  };
  const tip = rect && text ? createPortal(
    <div ref={node} id={id} role="tooltip" style={{ left: 0, top: 0, visibility: 'hidden' }} className="pointer-events-none fixed z-[1000] max-w-[min(18rem,calc(100vw-8px))] rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-slate-100 shadow-lg">
      {text}
    </div>,
    document.body,
  ) : null;
  return {
    tip,
    handlers: {
      onMouseEnter: (e) => show(e, DELAY),
      onMouseLeave: () => { pressed.current = false; hide(); },
      onFocus: (e) => { if (pressed.current) pressed.current = false; else show(e, 0); },
      onBlur: hide,
      onPointerDown: () => { pressed.current = true; hide(); },
      'aria-describedby': rect && text && describe ? id : undefined,
    },
  };
};

// <Tip text="..."><button .../></Tip>: adds the tooltip to one element, chaining the child's own handlers.
export const Tip = ({ text, describe, children }) => {
  const { tip, handlers } = useTip(text, { describe });
  const props = {};
  Object.entries(handlers).forEach(([k, f]) => {
    const own = children.props[k];
    props[k] = typeof f === 'function' ? (e) => { f(e); own?.(e); } : (f || own);
  });
  return <>{cloneElement(children, props)}{tip}</>;
};

export default Tip;
