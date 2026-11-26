import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeFixed, useDismiss } from '../ui/Tooltip';

export const field = 'focus-ring min-h-[44px] rounded-md border border-slate-700 bg-slate-900 px-2 text-xs text-slate-200 hover:border-slate-500 sm:min-h-0 sm:py-1';

// A button that opens a portalled, viewport-clamped panel (same pattern as the heatmap's Display menu): Esc, scroll and resize
// close it and return focus; an outside press just closes. `children` is the panel body.
const ObhMenu = ({ label, buttonLabel, width = 'w-56', children, className = field }) => {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  const close = useCallback(() => { setOpen(false); btn.current?.focus({ preventScroll: true }); }, []);
  useDismiss(open, close, btn);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useLayoutEffect(() => { if (open && pop.current && btn.current) placeFixed(pop.current, btn.current.getBoundingClientRect(), { prefer: 'below', align: 'start' }); }, [open]);
  useEffect(() => { if (open) pop.current?.querySelector('input,button')?.focus({ preventScroll: true }); }, [open]);
  return (
    <>
      <button ref={btn} type="button" aria-expanded={open} aria-haspopup="true" aria-label={buttonLabel || label} onClick={() => setOpen((o) => !o)} className={className}>{label}</button>
      {open && createPortal(
        <div ref={pop} role="group" aria-label={buttonLabel || label} style={{ left: 0, top: 0, visibility: 'hidden' }} className={`fixed z-40 ${width} max-w-[calc(100vw-8px)] rounded-md border border-slate-700 bg-slate-950 p-2 text-xs text-slate-200 shadow-lg`}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
};

export default ObhMenu;
