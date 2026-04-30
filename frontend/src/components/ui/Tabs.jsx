import React from 'react';

const Tabs = ({ tabs, activeId, onChange, className = '' }) => {
  return (
    <div className={`flex items-center gap-2 overflow-x-auto ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            activeId === tab.id
              ? 'bg-brand-600 text-white shadow-sm'
              : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

export default Tabs;
