import React from 'react';
import { Tip } from './Tooltip';

// Compact tab/segment switcher (timeframes, mobile panel tabs, bottom strip tabs).
const SegTabs = ({ tabs, active, onChange, label, className = '' }) => (
  <div role="tablist" aria-label={label} className={`inline-flex gap-0.5 ${className}`}>
    {tabs.map((t) => (
      <Tip key={t.id} text={t.title}>
      <button
        type="button"
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={`focus-ring rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          active === t.id ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {t.label}
      </button>
      </Tip>
    ))}
  </div>
);

export default SegTabs;
