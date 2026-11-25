import React from 'react';
import useAgentStore from '../../store/agentStore';

// 'Ask AI' button: opens the dock with the given context ({kind, symbol, page, interval?}).
// The dock returns focus to the element focused at open time, i.e. this button.
const AgentLauncher = ({ kind, symbol, page, interval, label = 'Ask AI', className = '' }) => (
  <button
    type="button"
    onClick={() => useAgentStore.getState().openWith({ kind, symbol, page, interval })}
    className={`focus-ring inline-flex items-center gap-1 rounded-md border border-brand-500/40 px-2 py-1 text-xs font-medium text-brand-400 hover:bg-brand-500/10 ${className}`}
  >
    {label}
  </button>
);

export default AgentLauncher;
