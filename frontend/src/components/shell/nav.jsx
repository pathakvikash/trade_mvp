import React from 'react';

// Single source of truth for app navigation (sidebar, mobile drawer and command palette).
export const Icon = ({ d, className = 'h-4 w-4' }) => (
  <svg className={`shrink-0 ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
};

export const NAV = [
  { path: '/dashboard', label: 'Dashboard', d: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },
  { path: '/market', label: 'Markets', d: 'M3 17l6-6 4 4 8-8M15 7h6v6' },
  { path: '/trade', label: 'Trade', d: 'M7 20V4M7 4L3 8M7 4l4 4M17 4v16M17 20l-4-4M17 20l4-4' },
  { path: '/derivatives', label: 'Derivatives', d: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5' },
  { path: '/liquidation', label: 'Liquidations', d: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z' },
  { path: '/portfolio', label: 'Portfolio', d: 'M4 8h16v12H4zM9 8V4h6v4' },
  { path: '/settings', label: 'Settings', d: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4' },
];
