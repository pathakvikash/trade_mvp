import React from 'react';

// Card grid of related liquidation tools. `href` marks a tool that exists in this app; the rest are disabled "Coming soon".
// Descriptions are one honest line each: they say what the tool shows, not what it predicts.
export const RELATED_TOOLS = [
  { name: 'Liquidation Map', desc: 'Estimated liquidation price levels for a coin, built from open interest and an assumed leverage mix.', href: '#liq-map' },
  { name: 'Liquidation Levels', desc: 'The largest estimated liquidation levels above and below the price, with USD sizes.', href: '#liq-levels' },
  { name: 'Liquidation Max Pain', desc: 'The price where the most estimated leveraged positions would be liquidated. Not built yet.' },
  { name: 'Order Book Heatmap', desc: 'Resting order size by price over time. Not built yet.' },
  { name: 'Large Orders', desc: 'Unusually large orders on the book or tape. Not built yet.' },
  { name: 'CVD', desc: 'Cumulative volume delta: buy volume minus sell volume over time. Not built yet.' },
];

const RelatedTools = () => (
  <section aria-labelledby="related-tools-h" className="space-y-2">
    <h2 id="related-tools-h" className="text-sm font-semibold text-slate-200">Related tools</h2>
    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {RELATED_TOOLS.map((t) => (
        <li key={t.name} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          {t.href ? (
            <a href={t.href} className="focus-ring text-sm font-medium text-cyan-300 hover:underline">{t.name}</a>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-400">{t.name}</span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">Coming soon</span>
            </div>
          )}
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{t.desc}</p>
        </li>
      ))}
    </ul>
  </section>
);

export default RelatedTools;
