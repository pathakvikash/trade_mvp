import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import usePersistedState, { oneOf } from '../../lib/usePersistedState';
import useUserStore from '../../store/userStore';
import SegTabs from '../ui/SegTabs';
import { Tip } from '../ui/Tooltip';
import Skeleton from '../ui/Skeleton';
import Spinner from '../ui/Spinner';
import { fmtPrice, fmtQty } from '../ui/fmt';
import { API, authed } from '../../lib/api';
import { addQuote, maxLeverage, openQuote, TAKER_FEE_BPS } from '../../lib/futuresMath';
import { baseTicker } from '../../lib/chartLines';
import SymbolCombobox from './SymbolCombobox';
import LeverageControl from './LeverageControl';
import TpSlFields, { tpSlErrors } from './TpSlFields';

const ORDER_TYPES = [{ id: 'market', label: 'Market' }, { id: 'limit', label: 'Limit' }];
const PCTS = [25, 50, 75, 100];

const inputCls =
  'focus-ring h-8 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-sm tabular-nums text-slate-100 placeholder:text-slate-600 disabled:text-slate-500';

export const PaperBadge = () => (
  <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
    Paper trading
  </span>
);

// Server error code -> friendly text. Unknown codes fall back to the server message.
const ERRORS = {
  UNKNOWN_MARKET: 'This market is not available for futures.',
  NO_PRICE: 'No live price for this market right now. Try again in a moment.',
  MIN_NOTIONAL: 'Order too small: the minimum order value is $5.',
  LEVERAGE_TOO_HIGH: 'Leverage is too high for this position size. Lower it or reduce the size.',
  MAX_POSITIONS: 'You have reached the maximum number of open positions.',
  MAX_ORDERS: 'You have reached the maximum number of open orders.',
  BAD_TPSL: 'Take profit / stop loss is out of range for this position.',
  INSUFFICIENT_BALANCE: 'Not enough balance for the margin and fee.',
  LEVERAGE_MISMATCH: 'You already hold this position at a different leverage. Add with the same leverage.',
  NOT_OPEN: 'That position or order is no longer open.',
  POSITION_BUSY: 'The position is being updated. Retry in a moment.',
  VALIDATION: 'Check the order fields and try again.',
  BAD_SIZE: 'That size is larger than the open position.',
  NOT_FOUND: 'That position or order was not found.',
  OP_FAILED: 'The order could not be completed. Check your positions and balance, then try again.',
};
export const futuresErrorText = (e) => {
  const d = e?.response?.data;
  if (e?.response?.status === 429) return 'Too many orders, slow down.';
  if (e?.response?.status === 401) return 'Your session has expired. Sign in again.';
  return ERRORS[d?.code] || d?.message || 'Unable to place the order at this time.';
};

// {BTC: 10, ...}: integer 1..50 per symbol, else the whole value is dropped
const validLevMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => Number.isInteger(x) && x >= 1 && x <= 50);

const Row = ({ label, children, tone = 'text-slate-100' }) => (
  <>
    <dt className="text-slate-400">{label}</dt>
    <dd className={`text-right font-medium tabular-nums ${tone}`}>{children}</dd>
  </>
);

// Futures order form. coin = { symbol (base), price }, futures = useFutures(), account = usePortfolio(); the parent
// keys this by symbol so switching symbols resets it. Previews mirror the server maths; the server is authoritative.
const FuturesForm = ({ coin, symbols = [], overview = [], onSymbol, token, futures, account }) => {
  const sym = coin?.symbol || '';
  const config = futures?.config;
  const balance = account?.balance;
  const [side, setSide] = useState('long');
  // Settings defaults (order type, leverage) apply until the user picks here; those picks are persisted and win.
  const prefs = useUserStore((st) => st.user?.preferences);
  const defLev = Number.isInteger(prefs?.defaultLeverage) && prefs.defaultLeverage >= 1 ? prefs.defaultLeverage : 10;
  const [orderType, setOrderType] = usePersistedState('trade.fut.orderType', prefs?.defaultOrderType === 'limit' ? 'limit' : 'market', { validate: oneOf('market', 'limit') });
  const [size, setSize] = useState('');
  const sizeRef = useRef(null);
  const [limitPrice, setLimitPrice] = useState('');
  const [levBySym, setLevBySym] = usePersistedState('trade.fut.leverage', {}, { validate: validLevMap });
  const [lev, setLev] = useState(() => Math.min(levBySym[sym] ?? defLev, maxLeverage(sym, 0, config?.tiers ? config : undefined)));
  const [tpsl, setTpsl] = useState({ tp: null, sl: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const clearMsg = () => setMessage((m) => (m.text ? { type: '', text: '' } : m));
  // Any field edit dismisses the previous result; a success message also clears itself after 10 s.
  const edited = (set) => (v) => { clearMsg(); set(v); };
  useEffect(() => {
    if (message.type !== 'success') return undefined;
    const t = setTimeout(() => setMessage({ type: '', text: '' }), 10000);
    return () => clearTimeout(t);
  }, [message]);

  // Only a user pick is remembered; LeverageControl also calls onChange to clamp to `max` when the size grows.
  const pickLev = (v) => {
    clearMsg();
    if (!(lev > max && v === max)) setLevBySym((m) => ({ ...m, [sym]: v }));
    setLev(v);
  };

  const isLimit = orderType === 'limit';
  const long = side === 'long';
  const existing = (futures?.positions || []).find((p) => p.status === 'open' && baseTicker(p.symbol) === sym && p.side === side) || null;
  const L = existing ? existing.leverage : lev; // adding to a position keeps its leverage
  const ref = isLimit ? Number(limitPrice) : Number(coin?.price);
  const hasRef = Number.isFinite(ref) && ref > 0;
  const sizeN = Number(size);
  const hasSize = Number.isFinite(sizeN) && sizeN > 0;

  const q = useMemo(() => {
    if (!hasRef || !hasSize) return null;
    return { open: openQuote(side, sizeN, ref, L, config), add: existing ? addQuote(existing, sizeN, ref, L, config) : null };
  }, [hasRef, hasSize, side, sizeN, ref, L, existing, config]);

  const capNotional = hasRef ? ((existing?.size || 0) + (hasSize ? sizeN : 0)) * ref : 0;
  const max = maxLeverage(sym, capNotional, config?.tiers ? config : undefined);
  const debit = q ? (q.add || q.open).debit / 100 : null;
  const liq = q ? (q.add || q.open).liqPrice : null;
  const tpslErr = hasRef && (tpsl.tp != null || tpsl.sl != null)
    ? tpSlErrors({ side, refPrice: ref, liqPrice: liq, tp: tpsl.tp, sl: tpsl.sl }) : null;
  const tpslBad = [tpsl.tp, tpsl.sl].some((x) => x != null && !Number.isFinite(x));
  const minNotional = config?.minNotional ?? 5;

  // First failing rule wins; it is shown under the button so a disabled submit is never a mystery.
  let reason = null;
  if (!config) reason = futures?.configError ? 'Futures settings failed to load.' : 'Loading futures settings…';
  else if (!hasRef) reason = isLimit ? 'Enter a limit price.' : 'Waiting for a live price.';
  else if (!hasSize) reason = 'Enter a size.';
  else if (sizeN * ref < minNotional) reason = `Minimum order value is $${minNotional}.`;
  else if (L > max) reason = `Max ${max}x at this size; lower the size.`;
  else if (balance != null && debit > balance) reason = 'Not enough balance for margin and fee.';
  else if (tpslErr || tpslBad) reason = 'Fix the take profit / stop loss.';

  const fillPct = (pct) => {
    if (!hasRef || !(balance > 0)) return;
    const perCoin = ref * (1 / L + (config?.takerFeeRate ?? TAKER_FEE_BPS / 10000)); // margin + fee per coin
    const n = Math.floor(((balance * pct) / 100 / perCoin) * 1e6 - (pct === 100 ? 2 : 0)) / 1e6;
    clearMsg();
    setSize(n > 0 ? String(n) : '');
  };

  const pickType = (t) => {
    clearMsg();
    setOrderType(t);
    if (t === 'limit' && !limitPrice && coin?.price != null) setLimitPrice(String(coin.price));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || reason) return;
    setBusy(true);
    setMessage({ type: '', text: '' });
    try {
      const body = {
        symbol: sym, side, type: orderType, size: sizeN, leverage: L,
        ...(isLimit ? { limitPrice: ref } : {}),
        ...(tpsl.tp != null ? { tp: tpsl.tp } : {}), ...(tpsl.sl != null ? { sl: tpsl.sl } : {}),
      };
      const { data } = await axios.post(`${API}/api/futures/orders`, body, authed(token));
      const what = `${long ? 'long' : 'short'} ${L}x ${fmtQty(sizeN)} ${sym}`;
      setMessage({
        type: 'success',
        text: `${data.fill
          ? `${existing ? 'Added to' : 'Opened'} ${what} @ ${fmtPrice(data.fill.price)}. Fee $${fmtPrice(data.fill.fee)}. Balance $${fmtPrice(data.balance)}.`
          : `Limit ${what} @ ${fmtPrice(ref)} placed. Reserved $${fmtPrice(data.order?.reserved)}. Balance $${fmtPrice(data.balance)}.`} Enter a size for the next order.`,
      });
      // Size is cleared on purpose (no accidental repeat fill); say so and put the cursor there for the next order.
      setSize('');
      sizeRef.current?.focus();
      setTpsl({ tp: null, sl: null });
      futures?.reload?.();
      account?.reload?.();
    } catch (err) {
      console.error(err.message); // the axios error object carries the Authorization header
      setMessage({ type: 'error', text: futuresErrorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const loading = account?.loading && balance == null;
  const label = `${isLimit ? 'Place limit' : existing ? 'Add' : 'Open'} ${side} ${L}x ${sym}`;

  return (
    <form onSubmit={submit} className="space-y-3">
      {onSymbol && <SymbolCombobox symbols={symbols} overview={overview} value={sym} onSelect={onSymbol} />}

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900 p-0.5" role="group" aria-label="Direction">
        {[['long', 'Long', 'bg-emerald-500 text-slate-950'], ['short', 'Short', 'bg-rose-500 text-white']].map(([id, text, on]) => (
          <button key={id} type="button" aria-pressed={side === id} onClick={() => { clearMsg(); setSide(id); }}
            className={`focus-ring h-7 rounded-md text-xs font-semibold transition-colors ${side === id ? on : 'text-slate-400 hover:text-slate-200'}`}>
            {text}
          </button>
        ))}
      </div>

      <SegTabs tabs={ORDER_TYPES} active={orderType} onChange={pickType} label="Order type" className="-ml-2" />

      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">Available</span>
        {loading ? <Skeleton className="h-3.5 w-20" /> : <span className="font-medium tabular-nums text-slate-100">{balance == null ? '--' : `$${fmtPrice(balance)}`}</span>}
      </div>

      {isLimit && (
        <div>
          <label htmlFor="fut-limit" className="mb-1 block text-[11px] text-slate-400">Limit price (USD)</label>
          <input id="fut-limit" className={inputCls} type="number" min="0" step="any" placeholder="0.00" value={limitPrice} onChange={(e) => { clearMsg(); setLimitPrice(e.target.value); }} />
        </div>
      )}

      <div>
        <label htmlFor="fut-size" className="mb-1 block text-[11px] text-slate-400">Size ({sym || '--'})</label>
        <input id="fut-size" ref={sizeRef} className={inputCls} type="number" min="0" step="any" placeholder="0.0000" value={size} onChange={(e) => { clearMsg(); setSize(e.target.value); }} />
        <div className="mt-1 flex items-center gap-1" role="group" aria-label="Size as share of available margin">
          {PCTS.map((p) => (
            <Tip key={p} text={`Size so margin + fee use ${p}% of free balance`}>
            <button type="button" onClick={() => fillPct(p)} disabled={!hasRef || !(balance > 0)}
              className="focus-ring h-6 flex-1 rounded-md border border-slate-800 bg-slate-950 text-[11px] tabular-nums text-slate-400 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
              {p}%
            </button>
            </Tip>
          ))}
        </div>
      </div>

      <LeverageControl value={L} max={max} onChange={pickLev} disabled={!!existing || busy} liqPrice={liq} requiredMargin={q ? q.open.margin / 100 : null} />
      {existing && <p className="text-[11px] text-slate-400">Adding to your open {side} at {existing.leverage}x: leverage is locked.</p>}

      <TpSlFields side={side} refPrice={hasRef ? ref : null} liqPrice={liq} value={tpsl} onChange={edited(setTpsl)} idPrefix="fut-tpsl" size={q ? (q.add ? q.add.size : sizeN) : undefined} entryPrice={q?.add?.entryPrice} leverage={L} disabled={busy} />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs" aria-label="Order preview">
        <Row label={isLimit ? 'Limit price' : 'Entry price (est.)'}>{hasRef ? `$${fmtPrice(ref)}` : '--'}</Row>
        <Row label="Notional">{q ? `$${fmtPrice(q.open.notional / 100)}` : '--'}</Row>
        <Row label={`Fee (${+((config?.takerFeeRate ?? TAKER_FEE_BPS / 10000) * 100).toFixed(4)}%)`}>{q ? `$${fmtPrice(q.open.fee / 100)}` : '--'}</Row>
      </dl>
      {existing && q && (
        <p className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] text-cyan-200">
          Adds to your open {side} ({fmtQty(existing.size)} {sym} @ {fmtPrice(existing.entryPrice)}). New avg entry ${fmtPrice(q.add.entryPrice)}, liq ${fmtPrice(q.add.liqPrice)}.
        </p>
      )}

      {message.text ? (
        <div role={message.type === 'error' ? 'alert' : 'status'} aria-live={message.type === 'error' ? 'assertive' : 'polite'} className={`flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${message.type === 'error' ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'}`}>
          <span>{message.text}</span>
          <Tip text="Dismiss"><button type="button" onClick={clearMsg} aria-label="Dismiss message" className="focus-ring -mr-1 shrink-0 rounded px-1 leading-none opacity-70 hover:opacity-100"><span aria-hidden="true">×</span></button></Tip>
        </div>
      ) : null}

      <div className="-mx-3 sticky bottom-0 z-10 space-y-1 border-t border-slate-800 bg-slate-950 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2">
      <button
        type="submit"
        disabled={busy || !!reason}
        aria-busy={busy}
        aria-describedby={reason && !busy ? 'fut-reason' : undefined}
        className={`focus-ring inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${long ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}
      >
        {busy && <Spinner size={14} />}
        {busy ? 'Submitting...' : label}
      </button>
      {reason && !busy && <p id="fut-reason" className="text-center text-[11px] text-slate-400">{reason}</p>}
      </div>
    </form>
  );
};

export default FuturesForm;
