import React from 'react';
import { useSocketStatus } from '../../lib/socket';

const CHIP = {
  connected: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Live' },
  connecting: { dot: 'animate-pulse bg-amber-400', text: 'text-amber-400', label: 'Reconnecting…' },
  disconnected: { dot: 'bg-rose-400', text: 'text-rose-400', label: 'Offline' },
};

// Live / Reconnecting… / Offline for the shared market socket.
const ConnectionChip = ({ socket }) => {
  const c = CHIP[useSocketStatus(socket)];
  return (
    <span role="status" className={`flex items-center gap-1.5 text-[11px] ${c.text}`} title={`Market feed: ${c.label}`}>
      <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />
      <span className="hidden md:inline">{c.label}</span>
      <span className="sr-only">Market feed {c.label}</span>
    </span>
  );
};

export default ConnectionChip;
