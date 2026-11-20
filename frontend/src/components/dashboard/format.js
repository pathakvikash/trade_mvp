// Display helpers shared by dashboard cards (pure).
export const fmtFunding = (f) => (Number.isFinite(f) ? `${f >= 0 ? '+' : ''}${(f * 100).toFixed(4)}%` : '--');

// Green for zero or positive, red for negative, muted when there is no number.
export const toneCls = (v) => (!Number.isFinite(v) ? 'text-slate-400' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');
