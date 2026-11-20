import React from 'react';

// Small inline spinner; inherits colour from text. Static when reduced motion is on.
const Spinner = ({ className = '', size = 14 }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" className={`motion-safe:animate-spin shrink-0 ${className}`}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

// 'Updating…' chip shown while a refetch runs over data that is already on screen.
export const Updating = ({ show, label = 'Updating…' }) => (show ? (
  <span role="status" className="inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
    <Spinner size={10} />
    {label}
  </span>
) : null);

export default Spinner;
