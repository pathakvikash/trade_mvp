import React from 'react';

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}%` : String(v ?? '-'));
const fmt = (k, v) => (typeof v === 'number' ? (/pct|return|drawdown|rate/i.test(k) ? pct(v) : String(Math.round(v * 100) / 100)) : String(v ?? '-'));

// Server's `describe` text + backtest stats + caveats (ALWAYS shown) + actions. All text is plain React text.
const StrategyCard = ({ strategy, onShow, onSave, onDiscard, busy, note }) => {
  const { describe, backtest } = strategy;
  const stats = backtest?.stats || {};
  const caveats = backtest?.caveats || [];
  return (
    <div className="mt-2 rounded-lg border border-slate-700/70 bg-slate-900/40 p-3 text-xs">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Strategy</h4>
      <p className="mt-1 text-slate-200">{describe}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-200">{fmt(k, v)}</dd></div>
        ))}
      </dl>
      {backtest?.evaluatedThrough != null && <p className="mt-1 text-slate-500">Evaluated through {String(backtest.evaluatedThrough)}</p>}
      <div role="alert" className="mt-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-amber-300">
        <strong>Overfitting warning.</strong> A strategy that looks good on past data is often tuned to that data and may fail on new data. Backtests are not predictions.
      </div>
      <ul aria-label="Backtest caveats" className="mt-2 list-disc space-y-0.5 pl-4 text-slate-400">
        {caveats.map((c, i) => <li key={i}>{String(c)}</li>)}
      </ul>
      {note && <p role="status" className="mt-2 text-amber-300">{note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {[['Show on chart', onShow], ['Save', onSave], ['Discard', onDiscard]].map(([t, fn]) => (
          <button key={t} type="button" disabled={busy} onClick={fn} className="focus-ring rounded-md border border-slate-700 px-2 py-1 font-medium text-slate-200 hover:bg-slate-900 disabled:opacity-50">{t}</button>
        ))}
      </div>
    </div>
  );
};

export default StrategyCard;
