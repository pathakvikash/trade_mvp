import React from 'react';

// Brand mark: a rising line on a rounded square with a folded paper corner (brand-600 #2563eb), original artwork.
// Standalone = role="img" labelled Paperline. With the wordmark the text names it, so the SVG is hidden;
// decorative = true hides it entirely (use when a nearby link/heading already says Paperline).
const Logo = ({ size = 28, withWordmark = false, decorative = false, className = '', wordmarkClassName = 'text-lg font-semibold tracking-tight text-white' }) => {
  const hidden = decorative || withWordmark;
  const a11y = hidden ? { 'aria-hidden': 'true' } : { role: 'img', 'aria-label': 'Paperline' };
  const mark = (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" focusable="false" {...a11y}>
      <path d="M8 0H22L32 10V24a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8V8a8 8 0 0 1 8-8Z" fill="#2563eb"/>
      <path d="M22 0V6a4 4 0 0 0 4 4h6Z" fill="#1e3a8a" fillOpacity=".55"/>
      <path d="M7 23l6-7 5 4 8-8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="26" cy="12" r="1.9" fill="#fff"/>
    </svg>
  );
  if (!withWordmark) return className ? <span className={`inline-flex ${className}`}>{mark}</span> : mark;
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {mark}
      <span className={wordmarkClassName}>Paperline</span>
    </span>
  );
};

export default Logo;
