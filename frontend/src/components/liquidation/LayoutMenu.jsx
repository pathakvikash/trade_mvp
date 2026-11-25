import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeFixed, useDismiss } from '../ui/Tooltip';

// Chart layout dropdown. Only 'single' is live; the other three are visible but disabled ("Coming soon").
// Disabled items stay focusable (aria-disabled) so keyboard and screen-reader users can find them, but never fire onChange.
export const LAYOUT_OPTIONS = [
  { id: 'single', label: 'Single chart', enabled: true },
  { id: 'side-by-side', label: 'Two side by side', enabled: false },
  { id: 'stacked', label: 'Two stacked', enabled: false },
  { id: 'four', label: 'Four-panel grid', enabled: false },
];

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 };
const Icon = ({ id }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className="shrink-0">
    <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2" {...P} />
    {id === 'side-by-side' && <path d="M8 2v12" {...P} />}
    {id === 'stacked' && <path d="M2 8h12" {...P} />}
    {id === 'four' && <path d="M8 2v12M2 8h12" {...P} />}
  </svg>
);

const LayoutMenu = ({ value = 'single', onChange }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const current = LAYOUT_OPTIONS.find((o) => o.id === value) || LAYOUT_OPTIONS[0];
  const items = () => [...(menu.current ? menu.current.querySelectorAll('[role="menuitemradio"]') : [])];

  // Portalled + fixed (placeFixed clamps to the viewport, 375px phones included) so overflow containers cannot clip it.
  useLayoutEffect(() => {
    if (open && menu.current && btn.current) placeFixed(menu.current, btn.current.getBoundingClientRect(), { prefer: 'below', align: 'start' });
  }, [open]);
  useDismiss(open, () => close(true), btn);

  // Focus the checked item on open.
  useEffect(() => {
    if (!open) return;
    const list = items();
    (list[LAYOUT_OPTIONS.findIndex((o) => o.id === current.id)] || list[0])?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => {
      if (!wrap.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
    };
  }, [open]);

  const close = (refocus) => {
    setOpen(false);
    if (refocus && btn.current) btn.current.focus();
  };

  const pick = (opt) => {
    if (!opt.enabled) return;
    if (onChange) onChange(opt.id);
    close(true);
  };

  const onKeyDown = (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); list[(n + list.length) % list.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={wrap} className="relative inline-block" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={btn}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 transition hover:border-slate-500 sm:min-h-[32px]"
      >
        <Icon id={current.id} />
        {current.label}
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className={`transition ${open ? 'rotate-180' : ''}`}>
          <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label="Chart layout"
          style={{ left: 0, top: 0, visibility: 'hidden' }}
          className="fixed z-40 w-64 max-w-[calc(100vw-1rem)] rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl"
        >
          {LAYOUT_OPTIONS.map((opt) => {
            const checked = opt.id === current.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-disabled={!opt.enabled}
                tabIndex={-1}
                onClick={opt.enabled ? () => pick(opt) : undefined}
                className={`focus-ring flex min-h-[44px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium ${
                  opt.enabled ? `text-slate-100 hover:bg-slate-800 ${checked ? 'bg-slate-800' : ''}` : 'cursor-not-allowed text-slate-500 opacity-60'
                }`}
              >
                <Icon id={opt.id} />
                <span className="flex-1">{opt.label}</span>
                {!opt.enabled && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Coming soon</span>}
                {checked && (
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
        )
      )}
    </div>
  );
};

export default LayoutMenu;
