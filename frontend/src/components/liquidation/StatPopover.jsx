import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tip, placeFixed, useDismiss } from '../ui/Tooltip';

// A stat whose button opens a details popover (children); hover or keyboard focus shows the short `tip`.
// Default trigger is a label over a value; `trigger` replaces that content and `className` the button's classes, so a
// row, tile or chip can be the trigger. Extra props (onMouseEnter, ...) go to the button. The popover is portalled and
// fixed, so scroll containers and overflow-hidden tiles cannot clip it. Closes on Esc, an outside press, scroll and resize.
// Keyboard: opening moves focus into the popover (first focusable item, else the container); Esc, scroll and Tab past
// either end close it and return focus to the trigger; focus leaving both the trigger and the popover just closes it.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const StatPopover = ({ label, value, tip, trigger, className, children, ...rest }) => {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const pop = useRef(null);
  const id = useId();
  const close = useCallback(() => { setOpen(false); btn.current?.focus({ preventScroll: true }); }, []);
  useDismiss(open, close, btn);
  const focusables = () => [...(pop.current?.querySelectorAll(FOCUSABLE) || [])];
  const leaves = (e) => !btn.current?.contains(e.relatedTarget) && !pop.current?.contains(e.relatedTarget);
  const onPopKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusables();
    const edge = items[e.shiftKey ? 0 : items.length - 1];
    if (!items.length || document.activeElement === edge || document.activeElement === pop.current) { e.preventDefault(); close(); }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!btn.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useEffect(() => { if (open) (focusables()[0] || pop.current)?.focus({ preventScroll: true }); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (open && pop.current && btn.current) placeFixed(pop.current, btn.current.getBoundingClientRect(), { prefer: 'below' }); }, [open]);

  const button = (
    <button
      {...rest}
      ref={btn}
      type="button"
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-controls={open ? id : undefined}
      onBlur={(e) => { rest.onBlur?.(e); if (open && leaves(e)) setOpen(false); }}
      onClick={(e) => { rest.onClick?.(e); setOpen((o) => !o); }}
      className={className || 'focus-ring rounded-md px-2 py-1 text-left text-xs text-slate-400 hover:text-slate-200'}
    >
      {trigger || (
        <>
          <span className="block text-[11px] uppercase tracking-wider">{label}</span>
          {value !== undefined && <span className="block font-medium tabular-nums text-slate-100">{value}</span>}
        </>
      )}
    </button>
  );
  return (
    <>
      {tip ? <Tip text={tip} describe={false}>{button}</Tip> : button}
      {open && createPortal(
        <div ref={pop} id={id} role="dialog" aria-label={label} tabIndex={-1} onKeyDown={onPopKey} onBlur={(e) => { if (leaves(e)) setOpen(false); }} style={{ left: 0, top: 0, visibility: 'hidden' }} className="fixed z-[900] outline-none w-64 max-w-[calc(100vw-8px)] rounded-md border border-slate-700 bg-slate-950 p-3 text-xs leading-relaxed text-slate-300 shadow-lg">
          {children}
        </div>,
        document.body,
      )}
    </>
  );
};

export default StatPopover;
