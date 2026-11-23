import React from 'react';
import Spinner from './Spinner';
import { Tip } from './Tooltip';

// Inline 24x24 stroke icons (no icon dependency; same style as shell/nav.jsx).
const P = {
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  half: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12l5 5 9-10" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 20a2 2 0 0 0 4 0" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  refresh: <path d="M20 11a8 8 0 1 0-2 5.3M20 5v6h-6" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  maximize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minimize: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></>,
};
export const Icon = ({ name, className = 'h-3.5 w-3.5' }) => (
  <svg className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {P[name]}
  </svg>
);

export { useTip } from './Tooltip';

const TONE = {
  default: 'text-slate-300 hover:bg-slate-800 hover:text-slate-100',
  cyan: 'text-cyan-200 hover:bg-cyan-400/10',
  danger: 'text-rose-300 hover:bg-rose-400/10',
};

// Compact 28px icon-only button. `label` is the aria-label and the tooltip (pass `tip` for a shorter tooltip).
const IconButton = ({ icon, label, tip, busy, tone = 'default', className = '', children, ...p }) => (
  <Tip text={tip || label} describe={!!tip && tip !== label}>
    <button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      {...p}
      className={`focus-ring inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center gap-1 rounded border border-slate-700 px-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50 ${TONE[tone]} ${className}`}
    >
      {busy ? <Spinner size={12} /> : icon && <Icon name={icon} />}
      {children}
    </button>
  </Tip>
);

export default IconButton;
