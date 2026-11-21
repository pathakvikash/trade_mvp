import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API, authed, errText } from '../../lib/api';
import { unrealized, leverageQuote, maxLeverage } from '../../lib/futuresMath';
import { baseTicker } from '../../lib/chartLines';
import { fmtPrice, fmtQty, fmtPct } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';
import Spinner from '../ui/Spinner';
import IconButton, { Icon } from '../ui/IconButton';
import { Tip, placeFixed, useDismiss } from '../ui/Tooltip';
import LeverageControl from './LeverageControl';
import { tpSlErrors } from './TpSlFields';

const FRIENDLY = {
  NOT_OPEN: 'This position is no longer open.',
  POSITION_BUSY: 'Position is being updated, try again in a moment.',
  BAD_SIZE: 'Invalid close size.',
  MIN_NOTIONAL: 'The remainder would be below the minimum size, close all instead.',
  NO_PRICE: 'No fresh price right now, try again shortly.',
  NOT_FOUND: 'Not found: it may have been closed. Refresh and try again.',
};
export const futuresErr = (e) => {
  const d = e?.response?.data;
  if (e?.response?.status === 429) return 'Too many requests, slow down.';
  return FRIENDLY[d?.code] || (d?.code === 'BAD_TPSL' ? d?.message || 'Invalid TP/SL.' : null) || d?.message || errText(e);
};

export const money = (v) => {
  if (!Number.isFinite(v)) return '--';
  const r = Math.round(Math.abs(v) * 100) / 100;
  return `${v < 0 && r > 0 ? '-' : '+'}$${fmtPrice(r)}`;
};
export const pnlCls = (v) => (!Number.isFinite(v) ? 'text-slate-500' : v >= 0 ? 'text-emerald-400' : 'text-rose-400');

// Live mark: the feed price for the base ticker, else the snapshot the server sent.
export const markOf = (pos, prices = {}) => {
  const live = prices[baseTicker(pos.symbol)];
  if (Number.isFinite(live) && live > 0) return live;
  return Number.isFinite(pos.markPrice) && pos.markPrice > 0 ? pos.markPrice : null;
};

const liqTone = (dist) => (dist == null ? 'text-slate-300' : dist < 5 ? 'text-rose-400' : dist < 15 ? 'text-amber-400' : 'text-slate-300');

const parseField = (s) => {
  const t = String(s).trim();
  if (t === '') return { v: null };
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? { v: n } : { err: 'Enter a positive price' };
};

const useWide = () => {
  const q = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 768px)') : null;
  const [wide, setWide] = useState(q ? q.matches : true);
  useEffect(() => {
    if (!q) return undefined;
    const f = () => setWide(q.matches);
    q.addEventListener?.('change', f);
    return () => q.removeEventListener?.('change', f);
  }, [q]);
  return wide;
};

const Btn = ({ children, busy, className = '', ...p }) => (
  <button
    type="button"
    {...p}
    aria-busy={busy || undefined}
    className={`focus-ring inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
  >
    {busy && <Spinner size={10} />}
    {children}
  </button>
);

// TP and SL price inputs ('' = none). Shared by the position edit panel and the open-order TP/SL edit.
export const TpSlInputs = ({ idPrefix, value, errs = {}, onChange, disabled }) => (
  <div className="flex flex-wrap gap-2">
    {['tp', 'sl'].map((k) => (
      <div key={k}>
        <label htmlFor={`${idPrefix}-${k}`} className="mb-0.5 block text-[10px] uppercase tracking-wider text-slate-500">{k === 'tp' ? 'Take profit' : 'Stop loss'}</label>
        <input
          id={`${idPrefix}-${k}`}
          aria-label={k === 'tp' ? 'Take profit' : 'Stop loss'}
          placeholder="None"
          inputMode="decimal"
          value={value[k]}
          disabled={disabled}
          aria-invalid={!!errs[k]}
          onChange={(e) => onChange({ ...value, [k]: e.target.value })}
          className="focus-ring w-28 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-100"
        />
        {errs[k] && <div role="alert" className="mt-0.5 max-w-[12rem] text-[10px] text-rose-300">{errs[k]}</div>}
      </div>
    ))}
  </div>
);

const priceText = (v) => (v == null ? '' : String(v));
// Inputs -> { tp, sl } numbers/null plus format errors; and which keys differ from `cur` (only those are sent).
export const readTpSl = (text, cur) => {
  const tp = parseField(text.tp);
  const sl = parseField(text.sl);
  return {
    tp: tp.v, sl: sl.v,
    fmt: { ...(tp.err && { tp: tp.err }), ...(sl.err && { sl: sl.err }) },
    changed: { tp: !tp.err && tp.v !== (cur.tp ?? null), sl: !sl.err && sl.v !== (cur.sl ?? null) },
  };
};

const EDIT_ERR = {
  INSUFFICIENT_BALANCE: 'Not enough free balance for the extra margin. Pick a higher leverage or free up funds.',
  LEVERAGE_TOO_HIGH: null, // server message names the cap
  LIQ_BREACH: null, // server message names the price
};
const editErr = (e) => EDIT_ERR[e?.response?.data?.code] || futuresErr(e);

// Edit an open position: TP, SL and leverage in one PATCH (the server applies them together or not at all).
// Preview numbers come from lib/futuresMath.leverageQuote, the same rounding as the server.
export const EditPanel = ({ pos, mark, config, token, onDone, onCancel, focus = 'tpsl' }) => {
  const rootRef = useRef(null);
  // Opened from the TP/SL pencil or the leverage badge: put the caret where the user was heading.
  useEffect(() => {
    rootRef.current?.querySelector(focus === 'leverage' ? '[data-edit="lev"] input[type="range"]' : 'input')?.focus();
  }, [focus]);
  const base = baseTicker(pos.symbol);
  const long = pos.side === 'long';
  const [text, setText] = useState({ tp: priceText(pos.tp), sl: priceText(pos.sl) });
  const [lev, setLev] = useState(pos.leverage);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');
  const max = Math.max(1, maxLeverage(base, pos.size * pos.entryPrice, config));

  const levChanged = lev !== pos.leverage;
  const q = levChanged ? leverageQuote(pos, lev, config) : null;
  const newLiq = q ? q.liqPrice : pos.liqPrice;
  const breach = q && Number.isFinite(mark) && (long ? newLiq >= mark : newLiq <= mark);
  const r = readTpSl(text, pos);
  // Same rule as the server: changed TP vs mark; SL (changed, or kept while leverage moves) vs mark and the NEW liq.
  const bounds = Number.isFinite(mark)
    ? tpSlErrors({ side: pos.side, refPrice: mark, liqPrice: newLiq, tp: r.changed.tp ? r.tp : null, sl: r.changed.sl || levChanged ? r.sl : null }) || {}
    : {};
  const errs = { tp: r.fmt.tp || bounds.tp || null, sl: r.fmt.sl || bounds.sl || null };
  const dirty = r.changed.tp || r.changed.sl || levChanged;
  const blocked = !!(errs.tp || errs.sl || breach || !dirty);

  const save = async () => {
    if (blocked) return;
    const body = {};
    if (r.changed.tp) body.tp = r.tp;
    if (r.changed.sl) body.sl = r.sl;
    if (levChanged) body.leverage = lev;
    setPending(true);
    setErr('');
    try {
      await axios.patch(`${API}/api/futures/positions/${pos._id}`, body, authed(token));
      onDone?.();
    } catch (e) {
      setErr(editErr(e));
      setPending(false);
    }
  };

  const usd = (c) => `$${fmtPrice(Math.abs(c) / 100)}`;
  return (
    <div ref={rootRef} role="group" aria-label={`Edit ${base} ${pos.side}`} className="rounded-lg border border-cyan-400/30 bg-slate-900/70 p-2 text-[11px] text-slate-300">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">TP / SL <span className="normal-case tracking-normal">(empty = none)</span></div>
          <TpSlInputs idPrefix={`pos-${pos._id}`} value={text} errs={errs} disabled={pending} onChange={(v) => { setText(v); setErr(''); }} />
        </div>
        <div data-edit="lev"><LeverageControl value={lev} max={max} onChange={(v) => { setLev(v); setErr(''); }} disabled={pending} liqPrice={newLiq} requiredMargin={q ? q.margin / 100 : pos.margin} previewId={`lev-preview-${pos._id}`} /></div>
        <div className="space-y-1" data-testid="edit-preview">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Effect</div>
          {q ? (
            <dl className="grid grid-cols-2 gap-x-2 tabular-nums">
              <dt className="text-slate-400">Leverage</dt><dd className="text-right">{pos.leverage}x → {lev}x</dd>
              <dt className="text-slate-400">Margin</dt><dd className="text-right">${fmtPrice(pos.margin)} → ${fmtPrice(q.margin / 100)}</dd>
              <dt className="text-slate-400">{q.delta >= 0 ? 'Released to balance' : 'Extra margin from balance'}</dt>
              <dd className={`text-right ${q.delta >= 0 ? 'text-emerald-400' : 'text-amber-300'}`} data-testid="margin-delta">{q.delta >= 0 ? '+' : '-'}{usd(q.delta)}</dd>
              <dt className="text-slate-400">Liq. price</dt><dd className="text-right" data-testid="new-liq">{fmtPrice(pos.liqPrice)} → {fmtPrice(newLiq)}</dd>
            </dl>
          ) : (
            <p className="text-slate-500">Leverage unchanged at {pos.leverage}x.</p>
          )}
          {breach && <p role="alert" className="text-rose-300">At {lev}x the liquidation price {fmtPrice(newLiq)} is already {long ? 'at or above' : 'at or below'} the mark {fmtPrice(mark)}: the position would be liquidated at once.</p>}
          {q && !breach && <p className="text-slate-500">Open limit orders on this side at {pos.leverage}x will be rejected (and refunded) when they fill.</p>}
          {err && <p role="alert" className="text-rose-300">{err}</p>}
          <div className="flex gap-1 pt-1">
            <Btn onClick={save} disabled={blocked || pending} busy={pending} aria-label={`Save changes to ${base} ${pos.side}`} className="border-cyan-400/50 text-cyan-200">Save</Btn>
            <Btn onClick={onCancel} disabled={pending} aria-label={`Cancel editing ${base} ${pos.side}`}>Cancel</Btn>
          </div>
        </div>
      </div>
    </div>
  );
};

const has = (v) => Number.isFinite(v) && v > 0;

// TP / SL values with a small pencil right next to them (pro-exchange style); 'Add TP/SL' when both are empty.
// Shared by position rows and futures open-order rows.
export const TpSlCell = ({ tp, sl, name, onEdit, disabled, expanded }) => (!has(tp) && !has(sl) ? (
  <button type="button" onClick={onEdit} disabled={disabled} aria-expanded={expanded} aria-label={`Add TP/SL to ${name}`}
    className="focus-ring rounded px-1 text-[11px] text-cyan-300/80 underline-offset-2 hover:text-cyan-200 hover:underline disabled:cursor-not-allowed disabled:opacity-60">
    Add TP/SL
  </button>
) : (
  <div className="flex items-center gap-1">
    <div className="text-left text-[11px] leading-tight">
      <span className={`block ${has(tp) ? 'text-emerald-400' : 'text-slate-500'}`}>TP {has(tp) ? fmtPrice(tp) : '--'}</span>
      <span className={`block ${has(sl) ? 'text-amber-400' : 'text-slate-500'}`}>SL {has(sl) ? fmtPrice(sl) : '--'}</span>
    </div>
    <IconButton icon="pencil" tone="cyan" onClick={onEdit} disabled={disabled} aria-expanded={expanded} label={`Edit TP/SL of ${name}`} tip="Edit TP / SL" className="h-6 min-w-[1.5rem] border-transparent" />
  </div>
));

const PCTS = [25, 50, 75, 100];

// One compact 'Close' split button: the main part closes 100% at market (armed 'Confirm?' first when the user keeps
// 'Confirm before closing' on); the chevron opens a portal menu of 25/50/75/100% market closes. Picking from the menu
// is already two deliberate clicks, so it does not arm a confirm.
const CloseSplit = ({ name, disabled, pending, confirm, onMain, onPct, partSize }) => {
  const [open, setOpen] = useState(false);
  const chev = useRef(null);
  const menu = useRef(null);
  const close = useRef((e) => {
    setOpen(false);
    if (e?.key === 'Escape') chev.current?.focus();
  }).current;
  useDismiss(open, close, chev);
  useLayoutEffect(() => {
    if (!open || !menu.current) return undefined;
    placeFixed(menu.current, chev.current.getBoundingClientRect(), { prefer: 'below', align: 'end', gap: 4 });
    menu.current.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (e) => { if (!menu.current?.contains(e.target) && !chev.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const onKey = (e) => {
    const items = [...menu.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (go !== undefined) { e.preventDefault(); items[(go + items.length) % items.length]?.focus(); }
    if (e.key === 'Tab') setOpen(false);
  };
  const seg = 'focus-ring inline-flex h-7 items-center border border-rose-400/40 text-[11px] font-medium text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <div className="inline-flex">
      <Tip text={confirm ? 'Click again to close the whole position' : 'Close 100% at market'}>
        <button type="button" onClick={onMain} disabled={disabled} aria-busy={pending === 'full' || undefined}
          aria-label={confirm ? `Confirm close all ${name}` : `Close ${name}`}
          className={`${seg} gap-1 rounded-l px-2 ${confirm ? 'bg-rose-400/15' : ''}`}>
          {pending === 'full' && <Spinner size={10} />}{confirm ? 'Confirm?' : 'Close'}
        </button>
      </Tip>
      <Tip text="Partial close">
        <button ref={chev} type="button" onClick={() => setOpen((v) => !v)} disabled={disabled} aria-busy={pending === 'part' || undefined}
          aria-haspopup="menu" aria-expanded={open} aria-label={`More close options for ${name}`}
          className={`${seg} -ml-px rounded-r px-1`}>
          {pending === 'part' ? <Spinner size={10} /> : <Icon name="chevron" className="h-3 w-3" />}
        </button>
      </Tip>
      {open && createPortal(
        <div ref={menu} role="menu" aria-label={`Close ${name} at market`} onKeyDown={onKey} style={{ left: 0, top: 0, visibility: 'hidden' }}
          className="fixed z-[1000] w-36 rounded-md border border-slate-700 bg-slate-900 p-1 text-[11px] text-slate-200 shadow-xl">
          <div className="px-2 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-slate-500">Market close</div>
          {PCTS.map((p) => (
            <button key={p} type="button" role="menuitem" disabled={p < 100 && !(partSize(p) > 0)}
              onClick={() => { setOpen(false); chev.current?.focus(); onPct(p); }}
              className="focus-ring flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-slate-800 focus:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40">
              <span>Close {p}%</span>{p === 100 && <span className="text-[10px] text-slate-500">all</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};

const Row = ({ pos, mark, wide, token, config, onSelectSymbol, onChanged }) => {
  const id = pos._id;
  const base = baseTicker(pos.symbol);
  const long = pos.side === 'long';
  const pl = mark ? unrealized(pos, mark) : null;
  const dist = mark ? (Math.abs(mark - pos.liqPrice) / mark) * 100 : null;
  const [pending, setPending] = useState(null); // 'full' | 'part'
  const [confirm, setConfirm] = useState(false);
  const confirmClose = useUserStore((st) => st.user?.preferences?.confirmClose !== false); // Settings > Preferences, default on
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null); // null | 'tpsl' | 'leverage' (which field the panel focuses)
  const openEdit = (f) => setEditing((cur) => (cur === f ? null : f));
  const locked = !!pos.busy;
  const disabled = locked || !!pending;
  useEffect(() => {
    if (!confirm || pending) return undefined;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm, pending]);

  const partSize = (pct) => Math.floor(((pos.size * pct) / 100) * 1e8) / 1e8;
  // pct 100 sends an empty body = full close; a partial that rounds to 0 is skipped (it would also be a full close).
  const close = async (pct = 100) => {
    const size = pct < 100 ? partSize(pct) : undefined;
    if (pct < 100 && !(size > 0)) return;
    setPending(pct < 100 ? 'part' : 'full');
    setErr('');
    try {
      await axios.post(`${API}/api/futures/positions/${id}/close`, size ? { size } : {}, authed(token));
      setConfirm(false);
      onChanged?.();
    } catch (e) {
      setErr(futuresErr(e));
    } finally {
      setPending(null);
    }
  };
  const name = `${base} ${pos.side}`;

  const cells = {
    sym: (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onSelectSymbol?.(base)} className="focus-ring font-medium text-slate-100 hover:text-cyan-300">{base}</button>
        {/* the side/leverage badge doubles as the leverage editor (pencil shows on hover/focus) */}
        <Tip text="Edit leverage">
          <button type="button" onClick={() => openEdit('leverage')} disabled={locked} aria-expanded={editing === 'leverage'} aria-label={`Edit leverage of ${name} (${pos.leverage}x)`}
            className={`focus-ring group inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold uppercase hover:ring-1 hover:ring-current disabled:cursor-not-allowed disabled:hover:ring-0 ${long ? 'bg-emerald-400/10 text-emerald-400' : 'bg-rose-400/10 text-rose-400'}`}>
            {long ? 'Long' : 'Short'} {pos.leverage}x
            <Icon name="pencil" className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        </Tip>
        {locked && <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1 py-0.5 text-[10px] text-amber-300">Under review</span>}
      </div>
    ),
    size: (
      <div>
        <div>{fmtQty(pos.size)} {base}</div>
        <div className="text-[10px] text-slate-500">{mark ? `$${fmtPrice(pos.size * mark)}` : '--'}</div>
      </div>
    ),
    entry: fmtPrice(pos.entryPrice),
    mark: mark ? fmtPrice(mark) : '--',
    liq: (
      <div className={liqTone(dist)}>
        <div>{fmtPrice(pos.liqPrice)}</div>
        <div className="text-[10px]" data-testid="liq-dist">{dist == null ? '--' : `${dist.toFixed(1)}% away`}</div>
      </div>
    ),
    margin: `$${fmtPrice(pos.margin)}`,
    pnl: (
      <div className={pnlCls(pl?.pnl)}>
        <div>{pl ? money(pl.pnl) : '--'}</div>
        <div className="text-[10px]">{pl ? `ROE ${fmtPct(pl.roe, 1)}` : ''}</div>
      </div>
    ),
    realised: <span className={pnlCls(pos.realizedPnl || 0)}>{money(pos.realizedPnl || 0)}</span>,
    tpsl: <TpSlCell tp={pos.tp} sl={pos.sl} name={name} onEdit={() => openEdit('tpsl')} disabled={disabled} expanded={editing === 'tpsl'} />,
    // Close all is two clicks (arms 'Confirm?' for 3 s) unless the user turned 'Confirm before closing' off.
    actions: (
      <CloseSplit name={name} disabled={disabled} pending={pending} confirm={confirm} partSize={partSize}
        onMain={() => (confirm || !confirmClose ? close(100) : setConfirm(true))} onPct={close} />
    ),
  };
  const errNode = err && <div role="alert" className="text-[11px] text-rose-300">{err}</div>;
  const panel = editing && !locked && (
    <EditPanel key={pos.rev} pos={pos} mark={mark} focus={editing} config={config} token={token} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); onChanged?.(); }} />
  );

  if (wide) {
    const td = 'whitespace-nowrap px-2 py-1.5 align-top';
    return (
      <>
        <tr className="border-t border-slate-800/60">
          <td className={`${td} sticky left-0 z-[1] bg-slate-950`}>{cells.sym}</td>
          <td className={`${td} text-right`}>{cells.size}</td>
          <td className={`${td} text-right`}>{cells.entry}</td>
          <td className={`${td} text-right`}>{cells.mark}</td>
          <td className={`${td} text-right`}>{cells.liq}</td>
          <td className={`${td} text-right`}>{cells.margin}</td>
          <td className={`${td} text-right`}>{cells.pnl}</td>
          <td className={`${td} text-right`}>{cells.realised}</td>
          <td className={td}>{cells.tpsl}</td>
          <td className={`${td} sticky right-0 z-[1] bg-slate-950 text-right`}><div className="flex justify-end">{cells.actions}</div></td>
        </tr>
        {err && <tr><td colSpan={10} className="px-2 pb-1">{errNode}</td></tr>}
        {/* sticky left keeps the panel in view while the table is scrolled sideways */}
        {panel && <tr><td colSpan={10} className="px-2 pb-2"><div className="sticky left-0 w-[min(100%,52rem)]">{panel}</div></td></tr>}
      </>
    );
  }
  const item = (label, node) => (
    <div><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div>{node}</div></div>
  );
  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-xs tabular-nums text-slate-300">
      <div className="flex items-start justify-between gap-2">{cells.sym}<div className="text-right">{cells.pnl}</div></div>
      <div className="grid grid-cols-3 gap-2">
        {item('Size', cells.size)}{item('Entry', cells.entry)}{item('Mark', cells.mark)}
        {item('Liq', cells.liq)}{item('Margin', cells.margin)}{item('Realised', cells.realised)}
      </div>
      {item('TP / SL', cells.tpsl)}
      {cells.actions}
      {errNode}
      {panel}
    </div>
  );
};

const HEAD = ['Symbol', 'Size', 'Entry', 'Mark', 'Liq', 'Margin', 'P/L (ROE)', 'Realised', 'TP / SL', ''];

// Open futures positions with live P/L. `prices` maps base ticker -> live futures last price. `onChanged` runs after a
// successful close / edit (pass futures.reload). `onSelectSymbol(base)` navigates the Trade page. `config` is
// /api/futures/config (leverage caps for the edit panel; local constants when null).
const PositionsTable = ({ positions = [], prices = {}, loading = false, config = null, onSelectSymbol, onChanged }) => {
  const token = useUserStore((s) => s.token);
  const wide = useWide();
  if (loading) {
    return (
      <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading positions">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-full" />)}
      </div>
    );
  }
  if (!positions.length) return <div className="py-2 text-xs text-slate-500">No open positions</div>;

  const marks = positions.map((p) => markOf(p, prices));
  const live = positions.map((p, i) => (marks[i] ? unrealized(p, marks[i]).pnl : null)).filter(Number.isFinite);
  const total = live.length ? live.reduce((a, b) => a + b, 0) : null;
  const margin = positions.reduce((s, p) => s + (p.margin || 0), 0);
  const rowProps = { wide, token, config, onSelectSymbol, onChanged };

  return (
    <div className="text-xs tabular-nums">
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400" data-testid="pos-summary">
        <span>Unrealised P/L <b className={pnlCls(total)}>{total === null ? '--' : money(total)}</b></span>
        <span>Margin used <b className="text-slate-200">${fmtPrice(margin)}</b></span>
        <span>Positions <b className="text-slate-200">{positions.length}</b></span>
      </div>
      {wide ? (
        // Own horizontal scroller with sticky symbol and action columns, so Close stays reachable at any width.
        <div className="overflow-x-auto">
        <table aria-label="Open futures positions" className="w-full border-separate border-spacing-0 text-slate-300">
          <thead>
            <tr>
              {HEAD.map((h, i) => (
                <th key={h || 'act'} scope="col" className={`sticky top-0 z-10 bg-slate-950 ${i === 0 ? 'left-0 z-20' : i === HEAD.length - 1 ? 'right-0 z-20' : ''} whitespace-nowrap px-2 pb-1 text-[10px] font-normal uppercase tracking-wider text-slate-500 ${i && i !== 8 ? 'text-right' : 'text-left'}`}>{h || <span className="sr-only">Actions</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => <Row key={p._id} pos={p} mark={marks[i]} {...rowProps} />)}
          </tbody>
        </table>
        </div>
      ) : (
        <div className="space-y-2">{positions.map((p, i) => <Row key={p._id} pos={p} mark={marks[i]} {...rowProps} />)}</div>
      )}
    </div>
  );
};

export default PositionsTable;
