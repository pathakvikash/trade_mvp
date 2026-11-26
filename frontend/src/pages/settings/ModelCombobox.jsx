import React, { useId, useMemo, useRef, useState } from 'react';
import { inputCls } from './shared';

// Same rule the server applies to model ids (MODEL_ID_RE), so a custom id that would be refused is not offered.
const ID_RE = /^[A-Za-z0-9._:/@-]{1,100}$/;
const SHOWN = 100;

const fmtCtx = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}K`);
const fmtUsd = (n) => (n >= 100 ? n.toFixed(0) : +n.toFixed(2)).toString();
export const modelMeta = (m) => {
  const bits = [];
  if (m.contextLength) bits.push(`${fmtCtx(m.contextLength)} ctx`);
  if (m.pricePerMTokIn !== undefined && m.pricePerMTokOut !== undefined && !m.free) bits.push(`$${fmtUsd(m.pricePerMTokIn)} in / $${fmtUsd(m.pricePerMTokOut)} out per 1M tokens`);
  return bits.join(' · ');
};

// Searchable list of the provider's models plus a "Use custom id" row. The input shows the saved/selected model; typing
// only filters, and the value changes when a row is chosen (click, Enter), so a typo is never silently saved.
const ModelCombobox = ({ id, value, models, onChange }) => {
  const listId = useId();
  const [query, setQuery] = useState(null); // null = not editing, show the value
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const q = (query ?? '').trim().toLowerCase();
  const rows = useMemo(() => {
    const hits = models.filter((m) => !q || `${m.id} ${m.name}`.toLowerCase().includes(q));
    const out = hits.slice(0, SHOWN).map((m) => ({ kind: 'model', m, id: m.id }));
    const typed = (query ?? '').trim();
    if (typed && ID_RE.test(typed) && !models.some((m) => m.id === typed)) out.push({ kind: 'custom', id: typed });
    return out;
  }, [models, q, query]);
  const known = !value || models.some((m) => m.id === value);

  const pick = (row) => { if (row) onChange(row.id); setQuery(null); setOpen(false); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); pick(rows[active]); }
    else if (e.key === 'Escape') { setQuery(null); setOpen(false); }
  };
  const onBlur = (e) => { if (!box.current?.contains(e.relatedTarget)) { setQuery(null); setOpen(false); } };

  return (
    <div ref={box} className="relative min-w-0" onBlur={onBlur}>
      <input
        id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        className={`${inputCls} min-h-[44px]`} placeholder="Search models or type an id" autoComplete="off" spellCheck={false} maxLength={100}
        value={query ?? value ?? ''} onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => { setOpen(true); setActive(Math.max(0, models.findIndex((m) => m.id === value))); }} onKeyDown={onKey}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="Models" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-950 shadow-lg">
          {rows.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">No model matches. Type a full id to use it as a custom id.</li>}
          {rows.map((r, i) => (
            <li
              key={`${r.kind}-${r.id}`} id={`${listId}-${i}`} role="option" aria-selected={r.id === value}
              className={`flex min-h-[44px] cursor-pointer flex-col justify-center px-3 py-1.5 ${i === active ? 'bg-cyan-500/10' : ''} ${r.id === value ? 'text-cyan-200' : 'text-slate-200'}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)} onMouseEnter={() => setActive(i)}
            >
              {r.kind === 'custom' ? (
                <span className="break-all text-sm">Use custom id <span className="font-mono">{r.id}</span></span>
              ) : (
                <>
                  <span className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 break-words">{r.m.name}</span>
                    {r.m.free && <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 text-[10px] font-semibold uppercase text-emerald-300">free</span>}
                  </span>
                  {r.m.name !== r.m.id && <span className="break-all font-mono text-[11px] text-slate-400">{r.m.id}</span>}
                  {modelMeta(r.m) && <span className="text-[11px] text-slate-500">{modelMeta(r.m)}</span>}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {!known && <p role="status" className="mt-1 break-all text-[11px] text-amber-300">{value} is not in the loaded list. It will be used as a custom id.</p>}
    </div>
  );
};

export default ModelCombobox;
