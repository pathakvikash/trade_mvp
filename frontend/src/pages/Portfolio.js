import React, { useMemo } from 'react';
import useUserStore from '../store/userStore';
import usePortfolio from '../lib/usePortfolio';
import usePolling from '../lib/usePolling';
import { FUT, coin as baseOf } from '../components/liquidation/shared';
import Card from '../components/ui/Card';

const formatCurrency = (value) => {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

const formatDate = (dateString) =>
  new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const Portfolio = () => {
  const token = useUserStore((s) => s.token);
  const { balance, holdings: base, trades, error, loading } = usePortfolio(token);
  const ov = usePolling(`${FUT}/overview`, 15000);

  // Value at the futures last/mark price (overview = top-40 perps). A missing price stays null (shown as --);
  // it must never turn into $0 / -100%.
  const { holdings, totalValue, totalPnL } = useMemo(() => {
    const px = {};
    (Array.isArray(ov.data) ? ov.data : []).forEach((r) => { px[baseOf(r.symbol)] = r.lastPrice ?? r.markPrice; });
    const rows = base.map((h) => {
      const currentPrice = Number.isFinite(px[h.symbol]) ? px[h.symbol] : null;
      if (currentPrice === null) return { ...h, currentPrice, value: null, pnL: null, pnLPercentage: null };
      const value = h.amount * currentPrice;
      const cost = h.amount * h.avgCost;
      const pnL = value - cost;
      return { ...h, currentPrice, value, pnL, pnLPercentage: cost > 0 ? (pnL / cost) * 100 : 0 };
    });
    const complete = rows.every((h) => h.value !== null);
    return {
      holdings: rows,
      totalValue: complete ? rows.reduce((s, h) => s + h.value, 0) : null,
      totalPnL: complete ? rows.reduce((s, h) => s + h.pnL, 0) : null,
    };
  }, [base, ov.data]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent mx-auto"></div>
          <p className="text-slate-300">Loading your portfolio...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card className="border-red-800/50 bg-red-950/20">
          <p className="text-red-300">Unable to load your portfolio: {error}</p>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-white">Portfolio</h1>
        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">Paper trading</span>
      </div>

      {/* Portfolio Summary */}
      <Card>
        <h2 className="mb-6 text-xl font-semibold text-white">Portfolio Summary</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Cash Balance</h3>
            <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(balance)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Holdings Value</h3>
            <p className="mt-2 text-2xl font-bold text-white">{formatCurrency(totalValue)}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Unrealized Profit/Loss</h3>
            <p className={`mt-2 text-2xl font-bold ${totalPnL === null ? 'text-slate-400' : totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(totalPnL)}
            </p>
          </div>
        </div>
      </Card>

      {/* Holdings */}
      <Card>
        <h2 className="mb-6 text-xl font-semibold text-white">Your Holdings</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Asset</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Amount</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Avg Buy Price</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Current Price</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Value</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">P/L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {holdings.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-sm text-slate-500">No holdings yet.</td></tr>
              )}
              {holdings.map((holding) => (
                <tr key={holding.symbol} className="hover:bg-slate-900/30">
                  <td className="py-4 font-medium text-white">{holding.symbol}</td>
                  <td className="py-4 text-white">{Number(holding.amount.toFixed(6))}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.avgCost)}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.currentPrice)}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.value)}</td>
                  <td className={`py-4 ${holding.pnL === null ? 'text-slate-400' : holding.pnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(holding.pnL)}
                    {holding.pnL !== null && (
                      <span className="text-sm">
                        ({holding.pnL >= 0 ? '+' : ''}{holding.pnLPercentage.toFixed(2)}%)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent Transactions */}
      <Card>
        <h2 className="mb-6 text-xl font-semibold text-white">Recent Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Type</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Asset</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Amount</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Price</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Fee</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {trades.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-sm text-slate-500">No transactions yet.</td></tr>
              )}
              {trades.map((tx) => (
                <tr key={tx._id} className="hover:bg-slate-900/30">
                  <td className={`py-4 font-medium capitalize ${tx.type === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {tx.type}
                  </td>
                  <td className="py-4 text-white">{tx.cryptoSymbol}</td>
                  <td className="py-4 text-white">{Number(tx.amount.toFixed(6))}</td>
                  <td className="py-4 text-white">{formatCurrency(tx.priceAtTrade)}</td>
                  <td className="py-4 text-white">{formatCurrency(tx.fee)}</td>
                  <td className="py-4 text-white">{formatDate(tx.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default Portfolio;
