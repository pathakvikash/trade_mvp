import React from 'react';

const Dot = ({ cls }) => <i aria-hidden="true" className={`mr-1 inline-block h-2.5 w-2.5 rounded-full border align-middle ${cls}`} />;

// Static explainer under the chart: what the picture is, how to read it, and the three things a wall can do.
const ObhExplainer = () => (
  <section aria-labelledby="obh-explain-h" className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">
    <h3 id="obh-explain-h" className="text-sm font-semibold text-slate-200">What is an orderbook heatmap?</h3>
    <p className="mt-1">Every few seconds we take a picture of the resting buy and sell orders. Each picture becomes one column; the brighter a cell, the more size was resting at that price. A bright band is a wall: a lot of size parked in one place.</p>
    <p className="mt-1">Worked example: price is 100 and a bright cell sits at 98 for ten minutes. Buyers are queued at 98. If price falls to 98 and the cell vanishes, the wall was hit (filled). If the cell vanishes while price is still at 100, it was cancelled (pulled).</p>
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
      <li><i aria-hidden="true" className="mr-1 inline-block h-0.5 w-4 bg-slate-300 align-middle" />Grey line = price</li>
      <li><Dot cls="border-emerald-400 bg-emerald-400/30" />Green circles = taker buys</li>
      <li><Dot cls="border-orange-400 bg-orange-400/30" />Orange-red circles = taker sells</li>
    </ul>
    <dl className="mt-3 grid gap-2 sm:grid-cols-3">
      <div className="rounded-lg border border-slate-800 p-2"><dt className="font-medium text-amber-300">Pulled</dt><dd>The wall disappears before price arrives. The size was never traded, often a sign it was a bluff or moved.</dd></div>
      <div className="rounded-lg border border-slate-800 p-2"><dt className="font-medium text-emerald-300">Filled</dt><dd>Price trades through the wall and it is eaten. The size was real and got used up.</dd></div>
      <div className="rounded-lg border border-slate-800 p-2"><dt className="font-medium text-cyan-300">Holds</dt><dd>Price reaches the wall and turns around while the size stays. Only the later columns show whether it held.</dd></div>
    </dl>
    <p className="mt-2 text-slate-500">Not advice: orders can be cancelled in a blink (spoofing), and we only know what the snapshots caught.</p>
  </section>
);

export default ObhExplainer;
