import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useMarketStore from '../../store/marketStore';
import { Icon, ICONS, NAV } from './nav';

const MAX_RESULTS = 12;

// Mounted only while open: focus goes to the input on mount and back to the opener on unmount.
const CommandPalette = ({ onClose }) => {
  const navigate = useNavigate();
  const marketData = useMarketStore((s) => s.marketData);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    input.current.focus();
    return () => opener && opener.focus && opener.focus();
  }, []);

  // Esc is handled on the document so it works wherever focus is while the palette is open.
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = NAV.filter((n) => n.label.toLowerCase().includes(q)).map((n) => ({
      id: `page-${n.path}`, group: 'Pages', label: n.label, hint: n.path, to: n.path, d: n.d,
    }));
    const coins = marketData
      .filter((c) => !q || c.symbol.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q))
      .map((c) => ({
        id: `coin-${c.symbol}`, group: 'Coins', label: c.symbol.toUpperCase(), hint: c.name, to: `/trade?symbol=${c.symbol.toUpperCase()}`,
      }));
    return [...pages, ...coins].slice(0, MAX_RESULTS);
  }, [query, marketData]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const go = (item) => {
    if (!item) return;
    navigate(item.to);
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
    else if (e.key === 'Enter') go(results[active]);
    else if (e.key !== 'Tab') return;
    // Tab: the input is the only focusable element, so swallowing it is the focus trap.
    e.preventDefault();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-3">
          <Icon d={ICONS.search} className="h-4 w-4 text-slate-500" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coins and pages"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? results[active].id : undefined}
            aria-label="Search coins and pages"
            className="h-11 w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
          />
          <kbd className="rounded border border-slate-700 px-1.5 text-[10px] text-slate-500">Esc</kbd>
        </div>
        {/* mousedown preventDefault keeps focus on the input */}
        <ul id="palette-list" ref={list} role="listbox" onMouseDown={(e) => e.preventDefault()} className="max-h-80 overflow-y-auto p-1.5">
          {results.map((r, i) => (
            <li
              key={r.id}
              id={r.id}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => go(r)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${i === active ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-300'}`}
            >
              {r.d ? <Icon d={r.d} /> : <span className="w-4 shrink-0 text-center text-[10px] text-slate-500">$</span>}
              <span className="font-medium">{r.label}</span>
              <span className="truncate text-xs text-slate-500">{r.hint}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-600">{r.group}</span>
            </li>
          ))}
          {results.length === 0 && <li className="px-2.5 py-6 text-center text-sm text-slate-500">No matches</li>}
        </ul>
      </div>
    </div>
  );
};

export default CommandPalette;
