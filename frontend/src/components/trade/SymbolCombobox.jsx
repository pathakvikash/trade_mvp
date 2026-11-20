import React, { useId, useMemo, useRef, useState } from 'react';
import { fmtPct, fmtPrice } from '../ui/fmt';
import { filterPairs } from '../ui/pairs';

// Searchable ticker picker for the order card: input + listbox (ARIA combobox, arrow keys / Enter / Escape).
// symbols: base tickers; overview: futures overview rows (lastPrice, priceChangePercent) for the price and 24h columns.
const SymbolCombobox = ({ symbols, overview = [], value, onSelect }) => {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const rows = useMemo(() => new Map(overview.map((r) => [r.symbol, r])), [overview]);
  const list = useMemo(
    () => filterPairs(symbols.map((s) => ({ base: s, symbol: `${s}USDT` })), q, rows),
    [symbols, q, rows],
  );
  const optId = (i) => `${id}-opt-${i}`;

  const close = () => { setOpen(false); setQ(''); setActive(0); };
  const pick = (p) => { close(); if (p && p.base !== value) onSelect(p.base); };

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(list.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); pick(list[active]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); close(); }
  };

  return (
    <div className="relative">
      <input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && list.length ? optId(active) : undefined}
        aria-autocomplete="list"
        aria-label="Token"
        placeholder="Search token, e.g. SOL"
        value={open ? q : value}
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => { setOpen(true); setQ(e.target.value); setActive(0); }}
        onKeyDown={onKey}
        className="focus-ring h-8 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-sm font-semibold text-slate-100 placeholder:font-normal placeholder:text-slate-500"
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label="Tokens" className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl">
          {list.map((p, i) => {
            const o = rows.get(p.symbol);
            return (
              <li
                key={p.symbol}
                id={optId(i)}
                role="option"
                aria-selected={p.base === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-xs tabular-nums ${i === active ? 'bg-slate-800 text-cyan-300' : 'text-slate-200'}`}
              >
                <span className="font-semibold">{p.base}</span>
                <span className="flex gap-2">
                  <span>{o ? fmtPrice(o.lastPrice ?? o.markPrice) : '--'}</span>
                  <span className={`w-14 text-right ${(o?.priceChangePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{o ? fmtPct(o.priceChangePercent) : '--'}</span>
                </span>
              </li>
            );
          })}
          {!list.length && <li role="presentation" className="px-2 py-3 text-center text-xs text-slate-400">No match</li>}
        </ul>
      )}
    </div>
  );
};

export default SymbolCombobox;
