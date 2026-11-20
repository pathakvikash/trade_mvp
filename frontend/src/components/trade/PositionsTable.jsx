import React, { useEffect, useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API, authed, errText } from '../../lib/api';
import { unrealized } from '../../lib/futuresMath';
import { baseTicker } from '../../lib/chartLines';
import { fmtPrice, fmtQty, fmtPct } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';
import Spinner from '../ui/Spinner';

const FRIENDLY = {
  NOT_OPEN: 'This position is no longer open.',
  POSITION_BUSY: 'Position is being updated, try again in a moment.',
  BAD_SIZE: 'Invalid close size.',
  MIN_NOTIONAL: 'The remainder would be below the minimum size, close all instead.',
  NO_PRICE: 'No fresh price right now, try again shortly.',
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

// Same bounds as the server: long tp > mark, liq < sl < mark; short tp < mark, mark < sl < liq. null = clear.
export const validateTpSl = (pos, mark, { tp, sl }) => {
  const out = {};
  if (!Number.isFinite(mark)) return out;
  const long = pos.side === 'long';
  if (tp != null && !(long ? tp > mark : tp < mark)) out.tp = `TP must be ${long ? 'above' : 'below'} ${fmtPrice(mark)}`;
  if (sl != null) {
    const ok = long ? sl > pos.liqPrice && sl < mark : sl < pos.liqPrice && sl > mark;
    if (!ok) out.sl = long ? `SL must be between ${fmtPrice(pos.liqPrice)} and ${fmtPrice(mark)}` : `SL must be between ${fmtPrice(mark)} and ${fmtPrice(pos.liqPrice)}`;
  }
  return out;
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

const Row = ({ pos, mark, wide, token, onSelectSymbol, onChanged }) => {
  const id = pos._id;
  const base = baseTicker(pos.symbol);
  const long = pos.side === 'long';
  const pl = mark ? unrealized(pos, mark) : null;
  const dist = mark ? (Math.abs(mark - pos.liqPrice) / mark) * 100 : null;
  const [pending, setPending] = useState(null); // 'full' | 'half' | 'tpsl'
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null); // { tp, sl, errs }
  const locked = !!pos.busy;
  const disabled = locked || !!pending;

  const halfSize = Math.floor((pos.size / 2) * 1e8) / 1e8;
  const close = async (half) => {
    if (half && !(halfSize > 0)) return; // an empty body would be a FULL close
    setPending(half ? 'half' : 'full');
    setErr('');
    try {
      const size = half ? halfSize : undefined;
      await axios.post(`${API}/api/futures/positions/${id}/close`, size ? { size } : {}, authed(token));
      setConfirm(false);
      onChanged?.();
    } catch (e) {
      setErr(futuresErr(e));
    } finally {
      setPending(null);
    }
  };

  const save = async () => {
    const tp = parseField(edit.tp);
    const sl = parseField(edit.sl);
    const errs = { tp: tp.err, sl: sl.err };
    if (!errs.tp && !errs.sl) Object.assign(errs, validateTpSl(pos, mark, { tp: tp.v, sl: sl.v }));
    if (errs.tp || errs.sl) { setEdit({ ...edit, errs }); return; }
    setPending('tpsl');
    setErr('');
    try {
      await axios.patch(`${API}/api/futures/positions/${id}`, { tp: tp.v, sl: sl.v }, authed(token));
      setEdit(null);
      onChanged?.();
    } catch (e) {
      setErr(futuresErr(e));
    } finally {
      setPending(null);
    }
  };

  const cells = {
    sym: (
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => onSelectSymbol?.(base)} className="focus-ring font-medium text-slate-100 hover:text-cyan-300">{base}</button>
        <span className={`rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${long ? 'bg-emerald-400/10 text-emerald-400' : 'bg-rose-400/10 text-rose-400'}`}>{long ? 'Long' : 'Short'} {pos.leverage}x</span>
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
    tpsl: edit ? (
      <div className="flex flex-col gap-1">
        {['tp', 'sl'].map((k) => (
          <div key={k}>
            <input
              aria-label={k === 'tp' ? 'Take profit' : 'Stop loss'}
              placeholder={k.toUpperCase()}
              inputMode="decimal"
              value={edit[k]}
              autoFocus={k === 'tp'}
              aria-invalid={!!edit.errs?.[k]}
              onChange={(e) => setEdit({ ...edit, [k]: e.target.value, errs: {} })}
              className="focus-ring w-24 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-100"
            />
            {edit.errs?.[k] && <div role="alert" className="max-w-[10rem] text-[10px] text-rose-300">{edit.errs[k]}</div>}
          </div>
        ))}
        <div className="flex gap-1">
          <Btn onClick={save} disabled={!!pending} busy={pending === 'tpsl'} aria-label={`Save TP/SL for ${base} ${pos.side}`}>Save</Btn>
          <Btn onClick={() => { setEdit(null); setErr(''); }} disabled={!!pending} aria-label={`Cancel TP/SL edit for ${base} ${pos.side}`}>Cancel</Btn>
        </div>
      </div>
    ) : (
      <button
        type="button"
        disabled={disabled}
        aria-label={`Edit TP/SL for ${base} ${pos.side}`}
        onClick={() => setEdit({ tp: pos.tp ?? '', sl: pos.sl ?? '', errs: {} })}
        className="focus-ring rounded px-1 text-left text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-60"
      >
        {pos.tp ? <span className="text-emerald-400">TP {fmtPrice(pos.tp)}</span> : <span className="text-slate-500">TP --</span>}
        {' / '}
        {pos.sl ? <span className="text-amber-400">SL {fmtPrice(pos.sl)}</span> : <span className="text-slate-500">SL --</span>}
      </button>
    ),
    actions: confirm ? (
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-400">Close all?</span>
        <Btn onClick={() => close(false)} disabled={disabled} busy={pending === 'full'} aria-label={`Yes, close all ${base} ${pos.side}`} className="border-rose-400/50 text-rose-300">Yes</Btn>
        <Btn onClick={() => setConfirm(false)} disabled={!!pending} aria-label={`No, keep ${base} ${pos.side}`}>No</Btn>
      </div>
    ) : (
      <div className="flex items-center gap-1">
        <Btn onClick={() => setConfirm(true)} disabled={disabled} aria-label={`Close ${base} ${pos.side}`}>Close</Btn>
        <Btn onClick={() => close(true)} disabled={disabled || !(halfSize > 0)} busy={pending === 'half'} aria-label={`Close 50% of ${base} ${pos.side}`}>50%</Btn>
      </div>
    ),
  };
  const errNode = err && <div role="alert" className="text-[11px] text-rose-300">{err}</div>;

  if (wide) {
    const td = 'px-2 py-1.5 align-top';
    return (
      <>
        <tr className="border-t border-slate-800/60">
          <td className={td}>{cells.sym}</td>
          <td className={`${td} text-right`}>{cells.size}</td>
          <td className={`${td} text-right`}>{cells.entry}</td>
          <td className={`${td} text-right`}>{cells.mark}</td>
          <td className={`${td} text-right`}>{cells.liq}</td>
          <td className={`${td} text-right`}>{cells.margin}</td>
          <td className={`${td} text-right`}>{cells.pnl}</td>
          <td className={`${td} text-right`}>{cells.realised}</td>
          <td className={td}>{cells.tpsl}</td>
          <td className={`${td} text-right`}><div className="flex justify-end">{cells.actions}</div></td>
        </tr>
        {err && <tr><td colSpan={10} className="px-2 pb-1">{errNode}</td></tr>}
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
    </div>
  );
};

const HEAD = ['Symbol', 'Size', 'Entry', 'Mark', 'Liq (dist)', 'Margin', 'Unrealised P/L', 'Realised', 'TP / SL', ''];

// Open futures positions with live P/L. `prices` maps base ticker -> live futures last price. `onChanged` runs after a
// successful close / TP-SL edit (pass futures.reload). `onSelectSymbol(base)` navigates the Trade page.
const PositionsTable = ({ positions = [], prices = {}, loading = false, onSelectSymbol, onChanged }) => {
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
  const rowProps = { wide, token, onSelectSymbol, onChanged };

  return (
    <div className="text-xs tabular-nums">
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400" data-testid="pos-summary">
        <span>Unrealised P/L <b className={pnlCls(total)}>{total === null ? '--' : money(total)}</b></span>
        <span>Margin used <b className="text-slate-200">${fmtPrice(margin)}</b></span>
        <span>Positions <b className="text-slate-200">{positions.length}</b></span>
      </div>
      {wide ? (
        <table aria-label="Open futures positions" className="w-full min-w-[900px] border-separate border-spacing-0 text-slate-300">
          <thead>
            <tr>
              {HEAD.map((h, i) => (
                <th key={h || 'act'} scope="col" className={`sticky top-0 z-10 bg-slate-950 px-2 pb-1 text-[10px] font-normal uppercase tracking-wider text-slate-500 ${i && i !== 8 ? 'text-right' : 'text-left'}`}>{h || <span className="sr-only">Actions</span>}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => <Row key={p._id} pos={p} mark={marks[i]} {...rowProps} />)}
          </tbody>
        </table>
      ) : (
        <div className="space-y-2">{positions.map((p, i) => <Row key={p._id} pos={p} mark={marks[i]} {...rowProps} />)}</div>
      )}
    </div>
  );
};

export default PositionsTable;
