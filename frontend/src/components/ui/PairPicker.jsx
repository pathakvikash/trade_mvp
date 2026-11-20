import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import usePolling from '../../lib/usePolling';
import { fmtCompact, fmtPct } from './fmt';
import { filterPairs } from './pairs';

const FUT = `${process.env.REACT_APP_API_URL || ''}/api/market/futures`;
// Symbol list: fetched once per page load (a failure clears the cache so the next open retries).
let symbolsP = null;
const loadSymbols = () => {
  if (!symbolsP) symbolsP = axios.get(`${FUT}/symbols`).then((r) => r.data).catch((e) => { symbolsP = null; throw e; });
  return symbolsP;
};

// Searchable pair selector: button + popover with a combobox search and listbox of matches.
const PairPicker = ({ value, onChange }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const button = useRef(null);
  const input = useRef(null);
  const [syms, setSyms] = useState({ data: null, error: null, loading: false });
  const [alignRight, setAlignRight] = useState(false); // trigger in the right half of the viewport: anchor the popover to its right edge
  const ov = usePolling(open ? `${FUT}/overview` : null, 30000);
  const symbols = useMemo(() => (Array.isArray(syms.data) ? syms.data : []), [syms.data]);
  const vol = useMemo(() => new Map((Array.isArray(ov.data) ? ov.data : []).map((r) => [r.symbol, r])), [ov.data]);
  const list = useMemo(() => filterPairs(symbols, q, vol), [symbols, q, vol]);
  const optId = (i) => `${id}-opt-${i}`;

  const close = (refocus) => { setOpen(false); setQ(''); setActive(0); if (refocus) button.current?.focus(); };
  const pick = (p) => { close(true); if (p && p.symbol !== value) onChange(p.symbol); };

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setSyms((s) => ({ ...s, loading: !s.data, error: null }));
    loadSymbols().then((data) => live && setSyms({ data, error: null, loading: false }), (error) => live && setSyms({ data: null, error, loading: false }));
    input.current?.focus();
    const away = (e) => { if (!root.current?.contains(e.target)) close(false); };
    document.addEventListener('mousedown', away);
    return () => { live = false; document.removeEventListener('mousedown', away); };
  }, [open]);
  useEffect(() => { document.getElementById(`${id}-opt-${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [id, active, list]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(list[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={root} className="relative inline-block">
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { if (open) { close(false); return; } setAlignRight(button.current.getBoundingClientRect().left > window.innerWidth / 2); setOpen(true); }}
        aria-label={`Change pair, current ${value}`}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setAlignRight(button.current.getBoundingClientRect().left > window.innerWidth / 2); setOpen(true); } }}
        className="focus-ring inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:border-slate-500"
      >
        {value}<span aria-hidden="true" className="text-xs text-slate-400">▾</span>
      </button>
      {open && (
        <div className={`absolute ${alignRight ? 'right-0' : 'left-0'} z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-xl`}>
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-activedescendant={list.length ? optId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Search pairs"
            placeholder="Search pair, e.g. SOL"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKey}
            className="focus-ring mb-2 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <ul id={`${id}-list`} role="listbox" aria-label="Pairs" className="max-h-72 overflow-y-auto">
            {list.map((p, i) => {
              const o = vol.get(p.symbol);
              return (
                <li
                  key={p.symbol}
                  id={optId(i)}
                  role="option"
                  aria-selected={p.symbol === value}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-sm tabular-nums ${i === active ? 'bg-slate-800 text-cyan-300' : 'text-slate-200'}`}
                >
                  <span>{p.base}<span className="text-slate-500">/USDT</span></span>
                  {o && (
                    <span className="flex gap-2 text-[11px]">
                      <span className={o.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtPct(o.priceChangePercent)}</span>
                      <span className="w-12 text-right text-slate-400">{fmtCompact(o.quoteVolume)}</span>
                    </span>
                  )}
                </li>
              );
            })}
            {!list.length && <li role="presentation" className="px-2 py-3 text-center text-xs text-slate-400">{syms.error ? 'Pair list unavailable.' : syms.loading ? 'Loading...' : 'No matches.'}</li>}
          </ul>
        </div>
      )}
    </div>
  );
};

export default PairPicker;
