import React from 'react';
import { Icon, ICONS } from '../shell/nav';
import useAlertStore from '../../store/alertStore';
import { describeAlert } from './alertLogic';

const Toasts = () => {
  const toasts = useAlertStore((s) => s.toasts);
  const dismiss = useAlertStore((s) => s.dismissToast);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-3 right-3 z-[60] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-2 rounded-xl border border-amber-400/40 bg-slate-950 p-3 shadow-lg">
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-[11px] font-medium uppercase tracking-wider text-amber-400">Alert triggered</p>
            <p className="mt-0.5 text-slate-200">{describeAlert(t)}</p>
            <p className="text-xs tabular-nums text-slate-400">Now {Number(t.observed).toLocaleString('en-US', { maximumFractionDigits: 6 })}</p>
            {t.note && <p className="mt-0.5 truncate text-xs text-slate-400">{t.note}</p>}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss alert" className="focus-ring rounded-md p-1 text-slate-400 hover:text-slate-100">
            <Icon d={ICONS.close} />
          </button>
        </div>
      ))}
    </div>
  );
};

export default Toasts;
