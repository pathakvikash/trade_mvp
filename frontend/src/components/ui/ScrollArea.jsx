import React, { useCallback, useEffect, useRef, useState } from 'react';

// Bounded inner scroller for long lists/tables: keyboard focusable region, top/bottom fade while more content exists.
// overscroll-behavior-y is inline `auto` so the wheel chains to the page at either end (the global .overflow-auto rule would trap it).
// Put <thead className="sticky top-0 ..."> inside for a pinned header; keep row keys stable so polling never resets scrollTop.
const ScrollArea = ({ label, footer, className = '', children }) => {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
    setEdge((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);
  useEffect(() => { measure(); }); // content grows on each poll; setEdge bails out when unchanged
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  return (
    <div className={className}>
      <div className="relative">
        <div
          ref={ref}
          role="region"
          aria-label={label}
          tabIndex={0}
          onScroll={measure}
          style={{ overscrollBehaviorY: 'auto' }}
          className="focus-ring max-h-80 overflow-auto rounded-md sm:max-h-[28rem]"
        >
          {children}
        </div>
        {edge.top && <div data-testid="fade-top" aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-slate-950/80 to-transparent" />}
        {edge.bottom && <div data-testid="fade-bottom" aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-slate-950/80 to-transparent" />}
      </div>
      {footer && <p className="mt-1 text-[11px] text-slate-500">{footer}</p>}
    </div>
  );
};

export default ScrollArea;
