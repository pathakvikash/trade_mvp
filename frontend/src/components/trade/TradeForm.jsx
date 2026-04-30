import React from 'react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';

const TradeForm = ({
  availableCoins,
  selectedCoin,
  tradeData,
  onChange,
  onTypeChange,
  onSubmit,
  message,
  isSubmitting,
}) => {
  const total = Number(tradeData.amount || 0) * Number(tradeData.priceAtTrade || 0);
  const formattedTotal = total ? `$${total.toFixed(2)}` : '$0.00';

  return (
    <div className="space-y-6 rounded-[1.1rem] border border-slate-800 bg-slate-950/95 p-6 shadow-soft backdrop-blur-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Trade Form</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Buy & Sell</h3>
        </div>
        <div className="flex items-center gap-2 rounded-3xl bg-slate-900/80 p-2">
          <button
            type="button"
            onClick={() => onTypeChange('buy')}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${tradeData.type === 'buy' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => onTypeChange('sell')}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${tradeData.type === 'sell' ? 'bg-red-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
          >
            Sell
          </button>
        </div>
      </div>

      <div className="space-y-5">
        <Select label="Trading Pair" name="cryptoSymbol" value={tradeData.cryptoSymbol} onChange={onChange}>
          <option value="">Select pair</option>
          {availableCoins.map((coin) => (
            <option key={coin.symbol} value={coin.symbol}>
              {coin.name} ({coin.symbol})
            </option>
          ))}
        </Select>

        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Amount"
            type="number"
            name="amount"
            value={tradeData.amount}
            onChange={onChange}
            placeholder="0.0000"
            min="0"
            step="0.000001"
          />
          <Input
            label="Price (USD)"
            type="number"
            name="priceAtTrade"
            value={tradeData.priceAtTrade}
            onChange={onChange}
            placeholder="0.00"
            min="0"
            step="0.01"
          />
        </div>

        {selectedCoin ? (
          <div className="rounded-3xl bg-slate-900/80 p-4 text-sm text-slate-300">
            <p className="font-medium text-white">{selectedCoin.name} · {selectedCoin.symbol}</p>
            <p className="mt-2 text-sm text-slate-400">Current market price: <span className="font-semibold text-white">${selectedCoin.price.toLocaleString()}</span></p>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 rounded-3xl bg-slate-900/80 px-4 py-4 text-sm text-slate-300">
          <div>
            <p className="text-slate-400">Estimated total</p>
            <p className="mt-1 text-lg font-semibold text-white">{formattedTotal}</p>
          </div>
          <div>
            <p className="text-slate-400">Order type</p>
            <p className="mt-1 text-lg font-semibold text-white">{tradeData.orderType || 'Market'}</p>
          </div>
        </div>

        {message.text ? (
          <div className={`rounded-2xl px-4 py-3 text-sm ${message.type === 'error' ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/20'}`}>
            {message.text}
          </div>
        ) : null}

        <Button type="submit" variant={tradeData.type === 'sell' ? 'danger' : 'success'} className="w-full py-4 text-base" onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Submitting...' : tradeData.type === 'sell' ? 'Place Sell Order' : 'Place Buy Order'}
        </Button>
      </div>
    </div>
  );
};

export default TradeForm;
