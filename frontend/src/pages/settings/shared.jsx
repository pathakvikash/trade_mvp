import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Panel from '../../components/ui/Panel';
import { errText } from '../../lib/api';

export const inputCls = 'focus-ring w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50';
export const labelCls = 'mb-1 block text-xs text-slate-400';
export const btnPrimary = 'focus-ring inline-flex items-center justify-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-40';
export const btnGhost = 'focus-ring inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900 disabled:opacity-40';
export const btnDanger = 'focus-ring inline-flex items-center justify-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40';

// The server's own message when it sent one; otherwise the shared mapping.
export const serverMsg = (e) => e.response?.data?.message || e.response?.data?.error || errText(e);

// Form state seeded from the saved values; re-seeded whenever they change (after load or a save).
export const useDraft = (saved) => {
  const key = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(JSON.parse(key)), [key]);
  return [draft, setDraft, key];
};
export const isDirty = (draft, key) => JSON.stringify(draft) !== key;

export const Spin = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 motion-safe:animate-spin" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

export const SectionCard = ({ title, description, tone, children }) => (
  <Panel title={title} bodyClassName="p-4 pt-2" className={tone === 'danger' ? '!border-rose-500/40' : ''}>
    {description && <p className="mb-3 text-xs text-slate-400">{description}</p>}
    {children}
  </Panel>
);

// Appears only while there is something to save; sticks to the bottom of the scrolling area.
export const SaveBar = ({ dirty, saving, onSave, onDiscard }) => {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 z-10 mt-4 flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur">
      <span className="text-xs text-amber-300">Unsaved changes</span>
      <span className="flex gap-2">
        <button type="button" className={btnGhost} onClick={onDiscard} disabled={saving}>Discard</button>
        <button type="button" className={btnPrimary} onClick={onSave} disabled={saving}>{saving && <Spin />}{saving ? 'Saving…' : 'Save'}</button>
      </span>
    </div>
  );
};

export const Field = ({ id, label, hint, children, className = '' }) => (
  <div className={className}>
    <label htmlFor={id} className={labelCls}>{label}</label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
  </div>
);

export const Toggle = ({ id, checked, onChange, label, hint, disabled }) => (
  <div className="flex items-start justify-between gap-4 py-1.5">
    <div className="min-w-0">
      <span id={`${id}-l`} className="block text-sm text-slate-200">{label}</span>
      {hint && <span id={`${id}-d`} className="block text-xs text-slate-400">{hint}</span>}
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-l`}
      aria-describedby={hint ? `${id}-d` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`focus-ring relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-50 ${checked ? 'border-emerald-400/60 bg-emerald-500/30' : 'border-slate-700 bg-slate-900'}`}
    >
      <span aria-hidden="true" className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${checked ? 'left-[18px] bg-emerald-300' : 'left-0.5 bg-slate-500'}`} />
    </button>
  </div>
);

// One toast at a time. Success hides itself after 4s; errors stay until dismissed or replaced.
export const useToast = () => {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (toast?.type !== 'success') return undefined;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const success = useCallback((text) => setToast({ type: 'success', text }), []);
  const error = useCallback((text) => setToast({ type: 'error', text }), []);
  const clear = useCallback(() => setToast(null), []);
  const notify = useMemo(() => ({ success, error }), [success, error]);
  return { toast, notify, clear };
};

export const Toast = ({ toast, onClose }) => {
  if (!toast) return null;
  const err = toast.type === 'error';
  return (
    <div
      role={err ? 'alert' : 'status'}
      className={`fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border px-3 py-2 text-sm shadow-xl shadow-black/50 ${err ? 'border-amber-400/40 bg-slate-950 text-amber-300' : 'border-emerald-400/40 bg-slate-950 text-emerald-300'}`}
    >
      <span className="min-w-0">{toast.text}</span>
      {err && <button type="button" className="focus-ring shrink-0 rounded px-1 text-xs text-slate-400 hover:text-slate-200" onClick={onClose} aria-label="Dismiss message">✕</button>}
    </div>
  );
};
