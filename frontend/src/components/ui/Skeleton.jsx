import React from 'react';

// Pulsing placeholder block; pass width/height/margin via className. Static (no pulse) when reduced motion is on.
const Skeleton = ({ className = '' }) => (
  <div aria-hidden="true" className={`motion-safe:animate-pulse rounded bg-slate-800/70 ${className}`} />
);

// A chart-sized pulsing block with visible 'Loading…' text, for panels that have no data yet.
export const LoadingBlock = ({ height = 180, label = 'Loading…' }) => (
  <div className="relative w-full" style={{ height }} role="status">
    <Skeleton className="h-full w-full" />
    <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">{label}</span>
  </div>
);

export default Skeleton;
