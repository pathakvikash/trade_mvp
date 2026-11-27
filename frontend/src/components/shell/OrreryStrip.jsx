import React from 'react';
import { ORRERY_URL } from '../../lib/orrery';

// "Part of Orrery" strip. Hidden unless REACT_APP_ORRERY_URL is set at build time.
const OrreryStrip = ({ url = ORRERY_URL }) => {
  if (!url) return null;
  return (
    <div className="flex h-8 shrink-0 items-center justify-center border-b border-white/10 bg-[#0b1220] text-xs text-slate-400">
      <span>Part of&nbsp;</span>
      <a href={url} className="font-medium text-sky-400 hover:underline" target="_blank" rel="noopener noreferrer">Orrery</a>
    </div>
  );
};

export default OrreryStrip;
