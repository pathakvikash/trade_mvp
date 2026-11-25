import React from 'react';

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}%` : String(v ?? '-'));
const fmt = (k, v) => (typeof v === 'number' ? (/pct|return|drawdown|rate/i.test(k) ? pct(v) : String(Math.round(v * 100) / 100)) : String(v ?? '-'));

const STATUS = {
  proposed: 'Proposal: nothing is drawn on any chart until you apply it.',
  applied: 'Applied to the chart. Declining removes it from the chart too.',
};

// A PROPOSAL from the AI: server's `describe` text + backtest stats + caveats (ALWAYS shown) + three separate actions:
// Apply to chart (accept), Save (to your list), Decline (discard the proposal). All text is plain React text.
const StrategyCard = ({ strategy, status = 'proposed', saved = false, allTimeframes = true, onAllTimeframes, onApply, onSave, onDecline, busy, note }) => {
  const { describe, backtest } = strategy;
  const stats = backtest?.stats || {};
  const caveats = backtest?.caveats || [];
  const designed = strategy.spec?.timeframe;
  const tf = backtest?.interval || designed;
  const applied = status === 'applied';
  const btn = 'focus-ring rounded-md border px-2 py-1 font-medium disabled:opacity-50';
  return (
    <div className="mt-2 rounded-lg border border-slate-700/70 bg-slate-900/40 p-3 text-xs" aria-label="Strategy proposal">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Strategy proposal</h4>
      <p className="mt-1 text-slate-200">{describe}</p>
      {designed && <p className="mt-1 text-slate-400">Designed on {designed}.</p>}
      <h5 className="mt-2 text-slate-400">Backtest{tf ? ` on ${tf}` : ''}</h5>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries(stats).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-200">{fmt(k, v)}</dd></div>
        ))}
      </dl>
      {backtest?.evaluatedThrough != null && <p className="mt-1 text-slate-500">Evaluated through {String(backtest.evaluatedThrough)}</p>}
      <p className="mt-1 text-slate-400">Results differ by timeframe: the same rules on a shorter timeframe use more bars of the same period lengths, so they cover a shorter stretch of time and behave differently. These stats are for {tf || 'one timeframe'} only.</p>
      <div role="alert" className="mt-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-amber-300">
        <strong>Overfitting warning.</strong> A strategy that looks good on past data is often tuned to that data and may fail on new data. Backtests are not predictions.
      </div>
      <ul aria-label="Backtest caveats" className="mt-2 list-disc space-y-0.5 pl-4 text-slate-400">
        {caveats.map((c, i) => <li key={i}>{String(c)}</li>)}
      </ul>
      <label className="mt-3 flex items-center gap-2 text-slate-300">
        <input type="checkbox" checked={allTimeframes} disabled={busy || applied} onChange={(e) => onAllTimeframes?.(e.target.checked)} />
        Apply on all timeframes{designed && !allTimeframes ? ` (off: pinned to ${designed})` : ''}
      </label>
      <p role="status" className="mt-2 text-slate-400">{saved ? 'Saved to your strategies. ' : ''}{STATUS[status]}</p>
      {note && <p role="status" className="mt-1 text-amber-300">{note}</p>}
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Proposal actions">
        <button type="button" disabled={busy || applied} aria-pressed={applied} onClick={onApply} className={`${btn} border-cyan-400/60 text-cyan-200 hover:bg-cyan-400/10`}>{applied ? 'Applied to chart' : 'Apply to chart'}</button>
        <button type="button" disabled={busy || saved} onClick={onSave} className={`${btn} border-slate-700 text-slate-200 hover:bg-slate-900`}>{saved ? 'Saved' : 'Save'}</button>
        <button type="button" disabled={busy} onClick={onDecline} className={`${btn} border-rose-400/40 text-rose-300 hover:bg-rose-400/10`}>Decline</button>
      </div>
    </div>
  );
};

export default StrategyCard;
