import React from 'react';

// Standard terminal panel: optional label row (label left, `right` slot) over the body.
const Panel = ({ title, right, className = '', bodyClassName = 'min-h-0 p-3', children }) => (
  <section className={`flex min-w-0 flex-col rounded-xl border border-slate-800/80 bg-slate-950/60 ${className}`}>
    {(title || right) && (
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{title}</h2>
        {right}
      </div>
    )}
    <div className={`flex-1 ${bodyClassName}`}>{children}</div>
  </section>
);

export default Panel;
