import React from 'react';

// Grid of "X Liquidation Heatmap" links for other perps. `symbols` are full perp symbols (e.g. ETHUSDT).
// onPick (optional) is called with the symbol instead of following the link, so the page can switch in place.
const OtherCoinsGrid = ({ symbols = [], onPick }) => {
  if (symbols.length === 0) {
    return <p className="text-xs text-slate-400">No other coins to show yet.</p>;
  }
  return (
    <ul aria-label="Other coins" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {symbols.map((s) => {
        const coin = s.replace(/USDT$/, '');
        return (
          <li key={s}>
            <a
              href={`/liquidation?symbol=${s}`}
              onClick={(e) => { if (onPick) { e.preventDefault(); onPick(s); } }}
              className="focus-ring block rounded-md border border-slate-800 px-2 py-1.5 text-xs text-cyan-300 hover:border-slate-600 hover:underline"
            >
              {coin} Liquidation Heatmap
            </a>
          </li>
        );
      })}
    </ul>
  );
};

export default OtherCoinsGrid;
