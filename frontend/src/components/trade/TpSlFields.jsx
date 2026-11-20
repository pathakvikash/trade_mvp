import React, { useState } from 'react';
import usePersistedState, { oneOf } from '../../lib/usePersistedState';
import SegTabs from '../ui/SegTabs';
import { fmtPrice } from '../ui/fmt';

// ponytail: minimal local helpers; swap for lib/futuresMath.js (unrealized/roe) once F1 lands.
const MODES = [{ id: 'price', label: 'Price' }, { id: 'roe', label: '% ROE' }];

const inputCls =
  'focus-ring h-8 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-sm tabular-nums text-slate-100 placeholder:text-slate-600 disabled:text-slate-500';

const clean = (n) => Number(n.toPrecision(8));

// Text -> trigger price. Price mode: the number itself. ROE mode: ROE magnitude (>0) turned into a price on the
// profit side (tp) or loss side (sl) of ref. '' -> null; unparseable -> NaN (flagged by tpSlErrors).
export const toPrice = (text, { kind, mode, side, refPrice, leverage = 1 }) => {
  if (text == null || String(text).trim() === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n)) return NaN;
  if (mode === 'price') return n;
  const move = (n / 100 / Math.max(1, leverage)) * refPrice; // price distance for that ROE
  const up = (side === 'long') === (kind === 'tp'); // long tp / short sl sit above ref
  return clean(up ? refPrice + move : refPrice - move);
};

// Price -> text in the given mode (ROE shown as a positive magnitude).
export const fromPrice = (price, { mode, refPrice, leverage = 1 }) => {
  if (price == null || !Number.isFinite(price)) return '';
  if (mode === 'price') return String(price);
  return String(Number(((Math.abs(price - refPrice) / refPrice) * Math.max(1, leverage) * 100).toFixed(2)));
};

// Bounds (spec §2): long tp>ref, liq<sl<ref; short tp<ref, ref<sl<liq. Returns { tp, sl } error strings or null.
export const tpSlErrors = ({ side, refPrice, liqPrice, tp, sl }) => {
  const long = side === 'long';
  const hasLiq = Number.isFinite(liqPrice) && liqPrice > 0;
  const f = (n) => fmtPrice(n);
  const err = { tp: null, sl: null };
  if (tp != null) {
    if (!(tp > 0)) err.tp = 'Take profit must be a price above 0.';
    else if (long && !(tp > refPrice)) err.tp = `Take profit must be above ${f(refPrice)} for a long.`;
    else if (!long && !(tp < refPrice)) err.tp = `Take profit must be below ${f(refPrice)} for a short.`;
  }
  if (sl != null) {
    if (!(sl > 0)) err.sl = 'Stop loss must be a price above 0.';
    else if (long && !(sl < refPrice)) err.sl = `Stop loss must be below ${f(refPrice)} for a long.`;
    else if (long && hasLiq && !(sl > liqPrice)) err.sl = `Stop loss must be above the liquidation price ${f(liqPrice)}.`;
    else if (!long && !(sl > refPrice)) err.sl = `Stop loss must be above ${f(refPrice)} for a short.`;
    else if (!long && hasLiq && !(sl < liqPrice)) err.sl = `Stop loss must be below the liquidation price ${f(liqPrice)}.`;
  }
  return err.tp || err.sl ? err : null;
};

const Trigger = ({ id, kind, label, mode, shown, error, pnl, disabled, onText }) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-[11px] text-slate-400">
      {label} {mode === 'roe' ? '(% ROE)' : '(price)'}
    </label>
    <input
      id={id}
      type="number"
      step="any"
      min="0"
      value={shown}
      disabled={disabled}
      onChange={(e) => onText(e.target.value)}
      placeholder={mode === 'roe' ? 'e.g. 25' : 'Optional'}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-err` : pnl ? `${id}-pnl` : undefined}
      className={inputCls}
    />
    {error ? (
      <p id={`${id}-err`} role="alert" className="mt-1 text-[11px] text-rose-300">{error}</p>
    ) : pnl ? (
      <p id={`${id}-pnl`} className={`mt-1 text-[11px] tabular-nums ${pnl.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
        {mode === 'roe' ? `Price ${fmtPrice(pnl.price)} · ` : ''}Est. PnL {pnl.pnl >= 0 ? '+' : '-'}${fmtPrice(Math.abs(pnl.pnl))}
        {pnl.roe != null ? ` (${pnl.roe >= 0 ? '+' : ''}${pnl.roe.toFixed(2)}% ROE)` : ''}
      </p>
    ) : null}
  </div>
);

// Controlled: value = { tp, sl } trigger PRICES (number | null). onChange emits the same shape; a price that breaks the
// bounds is still emitted (so the input shows what was typed) and flagged inline - parents gate submit with
// tpSlErrors(). Optional size (coins) and leverage enable the est. PnL / ROE lines.
const TpSlFields = ({ side, refPrice, liqPrice, value, onChange, idPrefix = 'tpsl', size, leverage = 1, margin, disabled = false, entryPrice }) => {
  const v = value || { tp: null, sl: null };
  const [enabled, setEnabled] = usePersistedState('trade.fut.tpslOpen', false, { validate: (x) => typeof x === 'boolean' });
  const [open, setOpen] = useState(enabled || v.tp != null || v.sl != null);
  const [mode, setMode] = usePersistedState('trade.fut.tpslMode', 'price', { validate: oneOf('price', 'roe') });
  const [drafts, setDrafts] = useState({});
  const hasRef = Number.isFinite(refPrice) && refPrice > 0;
  // P/L basis: where the position actually enters (new average when adding). Bounds still use refPrice.
  const basis = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : refPrice;
  const ctx = (kind) => ({ kind, mode, side, refPrice: basis, leverage });

  const errors = open && hasRef ? tpSlErrors({ side, refPrice, liqPrice, tp: v.tp, sl: v.sl }) : null;

  // A draft is only shown while it still maps to the controlled price; otherwise the prop wins (external reset/edit).
  const shown = (kind) => {
    const d = drafts[kind];
    if (d !== undefined && Object.is(toPrice(d, ctx(kind)), v[kind])) return d;
    return hasRef ? fromPrice(v[kind], { mode, refPrice: basis, leverage }) : '';
  };

  const est = (kind) => {
    const p = v[kind];
    if (!hasRef || errors?.[kind] || p == null || !(size > 0)) return null;
    const pnl = side === 'long' ? size * (p - basis) : size * (basis - p);
    const m = margin > 0 ? margin : (size * basis) / Math.max(1, leverage);
    return { price: p, pnl, roe: m > 0 ? (pnl / m) * 100 : null };
  };

  const setText = (kind, text) => {
    setDrafts((d) => ({ ...d, [kind]: text }));
    onChange({ ...v, [kind]: toPrice(text, ctx(kind)) });
  };

  const toggle = (on) => {
    setOpen(on);
    setEnabled(on);
    setDrafts({});
    if (!on) onChange({ tp: null, sl: null });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={`${idPrefix}-enable`} className="flex items-center gap-2 text-xs text-slate-300">
          <input id={`${idPrefix}-enable`} type="checkbox" checked={open} disabled={disabled} onChange={(e) => toggle(e.target.checked)} className="focus-ring" />
          TP/SL
        </label>
        {open && <SegTabs tabs={MODES} active={mode} onChange={(m) => { setMode(m); setDrafts({}); }} label="TP/SL input unit" />}
      </div>
      {open && (
        <>
          {!hasRef && <p className="text-[11px] text-slate-500">Waiting for a reference price.</p>}
          <Trigger id={`${idPrefix}-tp`} kind="tp" label="Take profit" mode={mode} shown={shown('tp')} error={errors?.tp} pnl={est('tp')} disabled={disabled || !hasRef} onText={(t) => setText('tp', t)} />
          <Trigger id={`${idPrefix}-sl`} kind="sl" label="Stop loss" mode={mode} shown={shown('sl')} error={errors?.sl} pnl={est('sl')} disabled={disabled || !hasRef} onText={(t) => setText('sl', t)} />
        </>
      )}
    </div>
  );
};

export default TpSlFields;
