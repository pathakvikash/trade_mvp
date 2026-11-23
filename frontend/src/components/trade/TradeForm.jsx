import React, { useState } from 'react';
import usePersistedState, { oneOf } from '../../lib/usePersistedState';
import useUserStore from '../../store/userStore';
import Panel from '../ui/Panel';
import { fmtPrice } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';
import Spinner from '../ui/Spinner';
import SegTabs from '../ui/SegTabs';
import SymbolCombobox from './SymbolCombobox';

const ORDER_TYPES = [{ id: 'market', label: 'Market' }, { id: 'limit', label: 'Limit' }];

const inputCls =
  'focus-ring h-8 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-sm tabular-nums text-slate-100 placeholder:text-slate-600 disabled:text-slate-500';

const Field = ({ id, label, ...props }) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-[11px] text-slate-400">{label}</label>
    <input id={id} className={inputCls} {...props} />
  </div>
);

// Local form state; the parent keys this by coin so switching symbols resets it.
// Market: the server fills at its own mark price, so no client price is sent. Limit: the user's limit price is sent and
// the order waits (funds reserved) until the mark crosses it.
const TradeForm = ({ coin, symbols = [], overview = [], onSymbol, onSubmit, message, isSubmitting, balance, balanceLoading, className = '', header = null }) => {
  const [side, setSide] = useState('buy');
  // The Settings default applies until the user picks a type here; that pick is persisted and wins from then on.
  const defType = useUserStore((st) => (st.user?.preferences?.defaultOrderType === 'limit' ? 'limit' : 'market'));
  const [orderType, setOrderType] = usePersistedState('trade.spot.orderType', defType, { validate: oneOf('market', 'limit') });
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');

  const isLimit = orderType === 'limit';
  const limitBad = isLimit && !(Number(limitPrice) > 0);
  const total = Number(amount || 0) * Number((isLimit ? limitPrice : coin?.price) || 0);
  const buy = side === 'buy';

  const pickType = (t) => {
    setOrderType(t);
    if (t === 'limit' && !limitPrice && coin?.price != null) setLimitPrice(String(coin.price));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return; // one order at a time, even if Enter is pressed again
    if (limitBad) return;
    if (await onSubmit({ type: side, amount, orderType, ...(isLimit ? { limitPrice } : {}) })) setAmount('');
  };

  return (
    <Panel
      title="Order"
      className={`h-fit ${className}`}
      right={
        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
          Paper trading
        </span>
      }
    >
      {header}
      <form onSubmit={submit} className="space-y-3">
        {onSymbol && <SymbolCombobox symbols={symbols} overview={overview} value={coin?.symbol || ''} onSelect={onSymbol} />}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-900 p-0.5" role="group" aria-label="Side">
          {[['buy', 'Buy', 'bg-emerald-500 text-slate-950'], ['sell', 'Sell', 'bg-rose-500 text-white']].map(([id, label, on]) => (
            <button
              key={id}
              type="button"
              aria-pressed={side === id}
              onClick={() => setSide(id)}
              className={`focus-ring h-7 rounded-md text-xs font-semibold transition-colors ${side === id ? on : 'text-slate-400 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <SegTabs tabs={ORDER_TYPES} active={orderType} onChange={pickType} label="Order type" className="-ml-2" />

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Paper balance</span>
          {balance == null && balanceLoading ? <Skeleton className="h-3.5 w-20" /> : <span className="font-medium tabular-nums text-slate-100">{balance == null ? '--' : `$${fmtPrice(balance)}`}</span>}
        </div>

        <Field id="order-amount" label={`Amount (${coin?.symbol || '--'})`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0000" min="0" step="any" />
        {isLimit ? (
          <div>
            <Field id="order-limit" label="Limit price (USD)" type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="0.00" min="0" step="any" aria-invalid={limitBad} aria-describedby={limitBad ? 'order-limit-err' : undefined} />
            {limitBad && <p id="order-limit-err" className="mt-1 text-[11px] text-rose-300">Limit price must be greater than 0.</p>}
          </div>
        ) : (
          <Field id="order-price" label="Price (USD)" value={coin ? `Market ~ ${fmtPrice(coin.price)}` : '--'} readOnly disabled />
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Estimated total (fee 0.1% extra)</span>
          <span className="font-medium tabular-nums text-slate-100">${fmtPrice(total)}</span>
        </div>

        {message.text ? (
          <div role="status" className={`rounded-lg border px-2.5 py-1.5 text-xs ${message.type === 'error' ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'}`}>
            {message.text}
          </div>
        ) : null}

        <div className="-mx-3 sticky bottom-0 z-10 border-t border-slate-800 bg-slate-950 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-2">
        <button
          type="submit"
          disabled={isSubmitting || !coin || !(Number(amount) > 0) || limitBad}
          aria-busy={isSubmitting}
          className={`focus-ring inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buy ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}
        >
          {isSubmitting && <Spinner size={14} />}
          {isSubmitting ? 'Submitting...' : `${isLimit ? `Place limit ${buy ? 'buy' : 'sell'}` : buy ? 'Buy' : 'Sell'} ${coin?.symbol || ''}`}
        </button>
        </div>
      </form>
    </Panel>
  );
};

export default TradeForm;
