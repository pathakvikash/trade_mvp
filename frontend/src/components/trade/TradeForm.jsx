import React, { useState } from 'react';
import Panel from '../ui/Panel';
import { fmtPrice } from '../ui/fmt';

const inputCls =
  'focus-ring h-8 w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 text-sm tabular-nums text-slate-100 placeholder:text-slate-600 disabled:text-slate-500';

const Field = ({ id, label, ...props }) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-[11px] text-slate-400">{label}</label>
    <input id={id} className={inputCls} {...props} />
  </div>
);

// Local form state; the parent keys this by coin so switching symbols resets it.
// Market orders only: the server fills at its own mark price, so there is no client price or limit field.
const TradeForm = ({ coin, onSubmit, message, isSubmitting, balance }) => {
  const [side, setSide] = useState('buy');
  const [amount, setAmount] = useState('');

  const total = Number(amount || 0) * Number(coin?.price || 0);
  const buy = side === 'buy';

  const submit = async (e) => {
    e.preventDefault();
    if (await onSubmit({ type: side, amount })) setAmount('');
  };

  return (
    <Panel
      title="Order"
      className="h-fit"
      right={
        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">
          Paper trading
        </span>
      }
    >
      <form onSubmit={submit} className="space-y-3">
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

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Paper balance</span>
          <span className="font-medium tabular-nums text-slate-100">{balance == null ? '--' : `$${fmtPrice(balance)}`}</span>
        </div>

        <Field id="order-amount" label={`Amount (${coin?.symbol || '--'})`} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0000" min="0" step="any" />
        <Field id="order-price" label="Price (USD)" value={coin ? `Market ~ ${fmtPrice(coin.price)}` : '--'} readOnly disabled />

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Estimated total (fee 0.1% extra)</span>
          <span className="font-medium tabular-nums text-slate-100">${fmtPrice(total)}</span>
        </div>

        {message.text ? (
          <div role="status" className={`rounded-lg border px-2.5 py-1.5 text-xs ${message.type === 'error' ? 'border-rose-400/30 bg-rose-400/10 text-rose-300' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'}`}>
            {message.text}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting || !coin || !(Number(amount) > 0)}
          className={`focus-ring h-9 w-full rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buy ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-rose-500 text-white hover:bg-rose-400'}`}
        >
          {isSubmitting ? 'Submitting...' : `${buy ? 'Buy' : 'Sell'} ${coin?.symbol || ''}`}
        </button>
      </form>
    </Panel>
  );
};

export default TradeForm;
