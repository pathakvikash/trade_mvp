import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import usePersistedState from '../../lib/usePersistedState';
import { TEMPLATES, LABEL, DISCLAIMER, BADGE, LABELS, FALLBACK_SYMBOLS, kindOf, rangeOf, defaultsFor, buildPrompt, sanity } from '../../lib/promptTemplates';
import rates from '../../lib/goalBaseRates.json';

const field = 'min-h-[44px] w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-base text-slate-100 sm:text-sm';

const Badge = () => <span className="inline-block rounded-full border border-amber-400/50 px-2 py-0.5 text-[11px] text-amber-300">{BADGE}</span>;

// Static, labelled with its data range: numbers come from the study, nothing here is live or a forecast.
const GoalBaseRates = ({ symbol }) => {
  const s = rates.symbols[symbol];
  return (
    <div data-testid="goal-baserates" className="rounded-md border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-300">
      <p>A +10% move within an hour almost never happens on BTC/SOL/LINK (0 of about 35,000 hourly windows); +0.5% to +1% is typical.</p>
      {s && <p className="mt-1">{symbol}: +0.5% touched in {s.touch05}% of 1h windows, +1% in {s.touch1}%, +10% in {s.touch10}% (the same odds apply to the matching loss).</p>}
      <p className="mt-1 text-[11px] text-slate-500">Data range: {rates.range}. Source: {rates.source}. {rates.note}</p>
    </div>
  );
};

const Form = ({ tpl, ctx, symbols, caps, onBack, onUse, onSend }) => {
  const [saved, setSaved] = usePersistedState(`promptTpl:${tpl.id}`, null, { validate: (v) => v && typeof v === 'object' && !Array.isArray(v) });
  const [values, setValues] = useState(() => defaultsFor(tpl, ctx, symbols, saved));
  const env = useMemo(() => ({ symbols, caps }), [symbols, caps]);
  const { errors, text } = buildPrompt(tpl, values, env);
  const arith = sanity(tpl, values);
  const set = (k, v) => setValues((o) => ({ ...o, [k]: v }));
  const act = (fn) => { if (!text) return; setSaved(values); fn(text); };

  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="focus-ring min-h-[44px] text-xs text-cyan-300 hover:underline">&larr; All templates</button>
      <h3 className="text-sm font-medium text-slate-100">{tpl.title}</h3>
      <Badge />
      {tpl.id === 'goal_reality_check' && <GoalBaseRates symbol={values.symbol} />}
      <form className="space-y-2" onSubmit={(e) => e.preventDefault()} aria-label={`${tpl.title} settings`}>
        {Object.entries(tpl.placeholders).map(([name, spec]) => {
          const kind = kindOf(name, spec);
          const id = `pt-${tpl.id}-${name}`;
          const err = errors[name];
          const [min, max] = kind === 'int' || kind === 'num' ? rangeOf(name, spec, caps) : [];
          const common = { id, value: values[name], className: `${field} ${err ? 'border-rose-500' : ''}`, 'aria-invalid': !!err, 'aria-describedby': err ? `${id}-err` : undefined };
          return (
            <div key={name}>
              <label htmlFor={id} className="mb-1 block text-xs text-slate-400">{LABELS[name] || name}{min != null ? ` (${min} to ${max})` : ''}</label>
              {kind === 'select' && <select {...common} onChange={(e) => set(name, e.target.value)}>{spec.allowed.map((a) => <option key={a} value={a}>{a}</option>)}</select>}
              {kind === 'symbol' && <><input {...common} list={`${id}-list`} autoComplete="off" onChange={(e) => set(name, e.target.value.toUpperCase())} /><datalist id={`${id}-list`}>{symbols.map((s) => <option key={s} value={s} />)}</datalist></>}
              {(kind === 'int' || kind === 'num') && <input {...common} type="text" inputMode="decimal" maxLength={9} onChange={(e) => set(name, e.target.value)} />}
              {kind === 'text' && <input {...common} type="text" maxLength={60} onChange={(e) => set(name, e.target.value)} />}
              {err && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-rose-400">{err}</p>}
            </div>
          );
        })}
      </form>
      {errors.form && <p role="alert" className="text-xs text-rose-400">{errors.form}</p>}
      {arith && <p data-testid="sanity" className="text-xs text-slate-300"><b>Arithmetic, not a forecast:</b> {arith}</p>}
      <div>
        <p className="mb-1 text-xs text-slate-400">Preview (exactly what will be sent)</p>
        <pre data-testid="preview" aria-label="Prompt preview" className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-slate-800 bg-slate-950 p-2 text-xs text-slate-300">{text ?? 'Fix the highlighted fields to see the prompt.'}</pre>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!text} onClick={() => act(onUse)} className="focus-ring min-h-[44px] rounded-md border border-slate-600 px-3 text-sm text-slate-100 disabled:opacity-50">Use in chat</button>
        <button type="button" disabled={!text} onClick={() => act(onSend)} className="focus-ring min-h-[44px] rounded-md bg-brand-500 px-3 text-sm font-medium text-white disabled:opacity-50">Send now</button>
      </div>
      <p className="text-[11px] text-slate-500">{DISCLAIMER}</p>
    </div>
  );
};

// Overlay inside the dock's chat pane. Esc steps back (form -> list -> closed) and never reaches the dock's own Esc.
const PromptTemplatePicker = ({ ctx, onUse, onSend, onClose }) => {
  const token = useUserStore((s) => s.token);
  const [pick, setPick] = useState(null);
  const [cfg, setCfg] = useState({});
  const ref = useRef(null);

  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('button')?.focus();
    return () => { if (prev?.isConnected) prev.focus(); };
  }, []);
  useEffect(() => {
    let live = true;
    Promise.resolve(axios.get(`${API}/api/bots/config`, authed(token))).then((r) => { if (live && r?.data && !Array.isArray(r.data)) setCfg(r.data); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  const caps = cfg.caps || {};
  // /api/bots/config lists bot symbols as BTC; chat prompts use BTCUSDT
  const symbols = useMemo(() => (Array.isArray(cfg.symbols) && cfg.symbols.length ? cfg.symbols.map((s) => (String(s).endsWith('USDT') ? s : `${s}USDT`)) : FALLBACK_SYMBOLS), [cfg.symbols]);
  const tpl = TEMPLATES.find((t) => t.id === pick);

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Prompt templates"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (pick) setPick(null); else onClose(); } }}
      className="absolute inset-0 z-10 flex flex-col bg-[#070b14]"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-1">
        <h2 className="text-sm font-medium text-slate-100">Templates</h2>
        <button type="button" aria-label="Close templates" onClick={onClose} className="focus-ring min-h-[44px] min-w-[44px] rounded-md text-slate-400 hover:text-slate-100">✕</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tpl
          ? <Form key={tpl.id} tpl={tpl} ctx={ctx} symbols={symbols} caps={caps} onBack={() => setPick(null)} onUse={onUse} onSend={onSend} />
          : (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">{LABEL}</p>
              <ul className="space-y-3">
                {TEMPLATES.map((t) => (
                  <li key={t.id} className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
                    <h3 className="text-sm font-medium text-slate-100">{t.title}</h3>
                    <p className="mt-1 text-xs text-slate-300">{t.description}</p>
                    <div className="mt-2"><Badge /></div>
                    <details className="mt-1 text-xs text-slate-400">
                      <summary className="min-h-[44px] cursor-pointer py-3">Why this is only a starter</summary>
                      <p><b>Works when:</b> {t.worksWhen}</p>
                      <p className="mt-1"><b>Does not work when:</b> {t.failsWhen}</p>
                      <p className="mt-1 text-slate-500">{t.evidence}</p>
                    </details>
                    <button type="button" onClick={() => setPick(t.id)} className="focus-ring min-h-[44px] rounded-md border border-brand-500/40 px-3 text-sm text-brand-400 hover:bg-brand-500/10">Use {t.title}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>
    </div>
  );
};

export default PromptTemplatePicker;
