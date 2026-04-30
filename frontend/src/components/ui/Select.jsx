import React from 'react';

const Select = ({ label, className = '', children, ...props }) => {
  return (
    <div className={`space-y-2 ${className}`}>
      {label ? <label className="block text-sm font-medium text-slate-300">{label}</label> : null}
      <select
        className="w-full rounded-2xl border border-slate-800 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        {...props}
      >
        {children}
      </select>
    </div>
  );
};

export default Select;
