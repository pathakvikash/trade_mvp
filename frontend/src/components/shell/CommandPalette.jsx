import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useMarketStore from '../../store/marketStore';
import usePolling from '../../lib/usePolling';
import usePersistedState, { writePersisted } from '../../lib/usePersistedState';
import { API } from '../../lib/apiBase';
import { MAX_SHOWN, baseOf, buildIndex, rankItems, suggestions, validRecents, addRecent } from '../../lib/tokenSearch';
import { fmtMarketPrice, fmtPct } from '../ui/fmt';
import { pct as instPct, price as instPrice } from '../../lib/instrumentFormat';
import { Icon, ICONS, NAV } from './nav';

const FUT = `${API}/api/market/futures`;
const SYMBOLS_MS = 300000; // ~700 perps change rarely: one fetch per 5 min, shared by every open of the palette
const INST_MS = 60000;

// Last good payloads survive closing the palette. A cache still fresh when the palette opens is not refetched this time.
const cache = {};
export const resetPaletteCache = () => { Object.keys(cache).forEach((k) => delete cache[k]); };
function useCached(key, url, ms, always) {
  const hit = cache[key];
  const [skip] = useState(() => !always && hit && Date.now() - hit.at < ms);
  const { data } = usePolling(skip ? null : url, ms);
  if (data && cache[key]?.data !== data) cache[key] = { at: Date.now(), data };
  return data || hit?.data || null;
}

// Per-token quick actions. First = Enter. Perps get Trade, Liquidations, Derivatives and Chart; spot-only coins just Trade.
const actionsFor = (it, go) => {
  if (it.kind === 'page') return [];
  if (it.kind === 'inst') {
    const to = it.cat === 'stock' ? `/stocks?symbol=${encodeURIComponent(it.symbol)}` : `/derivatives?instrument=${encodeURIComponent(it.symbol)}&category=${it.cat}`;
    return [{ id: 'open', label: it.cat === 'stock' ? 'Stocks' : 'Real markets', run: () => go(it, to) }];
  }
  const perp = `${it.symbol}USDT`;
  const list = [{ id: 'trade', label: 'Trade', run: () => go(it, `/trade?symbol=${it.symbol}`) }];
  if (it.perp) {
    list.push(
      { id: 'liq', label: 'Liquidations', run: () => go(it, `/liquidation?symbol=${perp}`) },
      // the Derivatives page keeps its pair in persisted state, not the URL
      { id: 'deriv', label: 'Derivatives', run: () => { writePersisted('derivatives.symbol', perp); go(it, '/derivatives'); } },
      { id: 'chart', label: 'Chart', run: () => go(it, `/market?symbol=${perp}`) },
    );
  }
  return list;
};

const Quote = ({ it, q }) => {
  const up = (q?.pct ?? 0) >= 0;
  return (
    <span className="ml-auto flex shrink-0 items-baseline gap-2 text-xs tabular-nums">
      <span className="w-20 text-right text-slate-300">{q ? q.price : '--'}</span>
      <span className={`w-14 text-right ${q ? (up ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-600'}`}>{q ? q.change : '--'}</span>
      <span className="sr-only">{it.symbol}</span>
    </span>
  );
};

// Mounted only while open: focus goes to the input on mount and back to the opener on unmount.
const CommandPalette = ({ onClose }) => {
  const navigate = useNavigate();
  const marketData = useMarketStore((s) => s.marketData);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [act, setAct] = useState(-1); // -1: the row itself, 0..n-1: one of its quick actions (Tab moves it)
  const [recents, setRecents] = usePersistedState('palette.recent', [], { validate: validRecents });
  const input = useRef(null);

  const perps = useCached('symbols', `${FUT}/symbols`, SYMBOLS_MS);
  const ov = useCached('overview', `${FUT}/overview`, 30000, true);
  const inst = useCached('inst', `${API}/api/market/instruments/quotes`, INST_MS);
  const overview = useMemo(() => (Array.isArray(ov) ? ov : []), [ov]);
  const instRows = useMemo(() => (Array.isArray(inst?.rows) ? inst.rows : []), [inst]);

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

  const coins = useMemo(() => marketData.map((c) => ({ symbol: c.symbol, name: c.name })), [marketData]);
  const index = useMemo(() => buildIndex({ perps, overview, coins, instruments: instRows }), [perps, overview, coins, instRows]);
  const pages = useMemo(() => NAV.map((n) => ({ id: `pal-page-${n.path}`, kind: 'page', symbol: n.label.toUpperCase(), label: n.label, name: '', to: n.path, d: n.d })), []);
  const vol = useMemo(() => new Map(overview.map((r) => [baseOf(r.symbol), Number(r.quoteVolume) || 0])), [overview]);
  const quotes = useMemo(() => {
    const m = new Map(overview.map((r) => [`pal-token-${baseOf(r.symbol)}`, { price: fmtMarketPrice(r.lastPrice ?? r.markPrice), pct: r.priceChangePercent, change: fmtPct(r.priceChangePercent) }]));
    instRows.forEach((r) => Number.isFinite(r.price) && m.set(`pal-inst-${r.symbol}`, { price: instPrice(r, r.price), pct: r.changePct, change: instPct(r.changePct) }));
    return m;
  }, [overview, instRows]);

  // entries: section headers and rows in display order; `items` is just the rows (what the arrows walk).
  const { entries, items, total } = useMemo(() => {
    const q = query.trim();
    const e = [];
    const rows = [];
    const section = (title, list) => {
      if (!list.length) return;
      e.push({ header: title });
      list.forEach((it) => { e.push(it); rows.push(it); });
    };
    let count;
    if (!q) {
      const sug = suggestions(index, overview, recents);
      section('Suggested', sug);
      section('Pages', pages);
      count = rows.length;
    } else {
      const ranked = rankItems([...index, ...pages], q, vol);
      count = ranked.length;
      const ids = new Set(ranked.map((r) => r.id));
      const rec = suggestions([], [], recents).map((r) => index.find((i) => i.id === r.id)).filter((r) => r && ids.has(r.id)).slice(0, 3);
      section('Suggested', rec.map((r) => ({ ...r, why: 'Recent' })));
      const used = new Set(rec.map((r) => r.id));
      section('Results', ranked.filter((r) => !used.has(r.id)).slice(0, MAX_SHOWN - rec.length));
    }
    return { entries: e, items: rows, total: count };
  }, [query, index, overview, recents, pages, vol]);

  useEffect(() => { setActive(0); setAct(-1); }, [query]);
  const cur = items[active];
  const curActions = cur ? actionsFor(cur, () => {}) : [];
  const activeId = cur ? (act >= 0 && curActions[act] ? `${cur.id}-${curActions[act].id}` : cur.id) : undefined;
  useEffect(() => {
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const go = (it, to) => {
    if (it.kind !== 'page') setRecents(addRecent(recents, it.kind, it.symbol));
    navigate(to);
    onClose();
  };
  const actions = (it) => (it.kind === 'page' ? [{ id: 'open', label: it.label, run: () => go(it, it.to) }] : actionsFor(it, go));

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { setActive((a) => Math.min(a + 1, items.length - 1)); setAct(-1); }
    else if (e.key === 'ArrowUp') { setActive((a) => Math.max(a - 1, 0)); setAct(-1); }
    else if (e.key === 'Enter') { if (cur) actions(cur)[Math.max(act, 0)]?.run(); }
    else if (e.key === 'Tab') {
      // The input keeps focus; Tab walks the quick actions of the highlighted row (aria-activedescendant follows), then back to the row.
      const n = curActions.length;
      // Action 0 is what Enter on the row does, so Tab starts at the second one.
      if (n > 1) setAct((a) => (e.shiftKey ? (a < 0 ? n - 1 : a - 1 <= 0 ? -1 : a - 1) : (a < 0 ? 1 : a + 1 >= n ? -1 : a + 1)));
    } else return;
    e.preventDefault();
  };

  const q = query.trim();
  const status = !q ? `${items.length} suggestions` : total === 0 ? 'No matches' : `${total} result${total === 1 ? '' : 's'}${total > MAX_SHOWN ? `, showing ${MAX_SHOWN}` : ''}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 sm:px-4 sm:pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="flex h-full w-full flex-col overflow-hidden bg-slate-950 shadow-2xl shadow-black/60 sm:h-auto sm:max-w-xl sm:rounded-xl sm:border sm:border-slate-700/80"
      >
        <div className="flex items-center gap-2 border-b border-slate-800 px-3">
          <Icon d={ICONS.search} className="h-4 w-4 text-slate-500" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any token, stock or page"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-label="Search tokens and pages"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck="false"
            className="h-12 w-full bg-transparent text-base text-slate-100 outline-none placeholder:text-slate-500 sm:h-11 sm:text-sm"
          />
          <button type="button" onClick={onClose} className="focus-ring min-h-11 shrink-0 px-2 text-xs text-slate-400 sm:hidden">Close</button>
          <kbd className="hidden rounded border border-slate-700 px-1.5 text-[10px] text-slate-500 sm:inline">Esc</kbd>
        </div>
        <div role="status" aria-live="polite" className="sr-only">{status}</div>
        {/* fixed height on desktop so the box does not jump while results change; mousedown preventDefault keeps focus on the input */}
        <ul id="palette-list" role="listbox" aria-label="Results" onMouseDown={(e) => e.preventDefault()} className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:h-96 sm:flex-none">
          {entries.map((r) => {
            if (r.header) return <li key={`h-${r.header}`} role="presentation" className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">{r.header}</li>;
            const i = items.indexOf(r);
            const on = i === active;
            const acts = actions(r);
            const q2 = quotes.get(r.id);
            return (
              <li
                key={r.id}
                id={r.id}
                role="option"
                aria-selected={on}
                onMouseMove={() => { if (!on) { setActive(i); setAct(-1); } }}
                onClick={() => acts[0]?.run()}
                className={`flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 text-sm max-sm:min-h-11 ${on ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-300'}`}
              >
                {r.d ? <Icon d={r.d} /> : <span className="w-4 shrink-0 text-center text-[10px] text-slate-500">{r.kind === 'inst' ? '#' : '$'}</span>}
                <span className="font-medium">{r.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500 sm:flex-none sm:basis-28">{r.kind === 'page' ? r.to : r.name}</span>
                {r.kind === 'page'
                  ? <span className="ml-auto text-[10px] uppercase tracking-wider text-slate-600">Page</span>
                  : <Quote it={r} q={q2} />}
                {r.why && <span className="text-[10px] uppercase tracking-wider text-slate-600">{r.why}</span>}
                {r.kind !== 'page' && (
                  <span className={`flex w-full flex-wrap gap-1.5 pl-7 ${on ? '' : 'sm:invisible'}`}>
                    {acts.map((a, n) => (
                      <button
                        key={a.id}
                        id={`${r.id}-${a.id}`}
                        type="button"
                        tabIndex={-1}
                        aria-label={`${a.label} for ${r.symbol}`}
                        onClick={(e) => { e.stopPropagation(); a.run(); }}
                        className={`min-h-11 rounded-md border px-3 text-xs sm:min-h-6 sm:px-2 ${on && act === n ? 'border-cyan-300 bg-cyan-400/20 text-cyan-200' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
                      >{a.label}</button>
                    ))}
                  </span>
                )}
              </li>
            );
          })}
          {q && total === 0 && (
            <li role="presentation" className="px-2.5 py-6 text-center text-sm text-slate-500">
              No matches for “{q}”. Check the spelling, or try a ticker (BTC), a stock (RELIANCE) or an index (NIFTY).
            </li>
          )}
          {total > MAX_SHOWN && q && <li role="presentation" className="px-2.5 py-2 text-center text-xs text-slate-500">Showing {MAX_SHOWN} of {total}. Type to narrow.</li>}
          {!perps && <li role="presentation" className="px-2.5 py-2 text-center text-xs text-slate-600">Loading the full token list...</li>}
        </ul>
        <p className="hidden border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-500 sm:block">Enter opens Trade · Tab for Liquidations, Derivatives, Chart · Esc closes</p>
      </div>
    </div>
  );
};

export default CommandPalette;
