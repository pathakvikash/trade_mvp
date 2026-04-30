import React from 'react';
import Card from '../ui/Card';

const PortfolioSummary = React.memo(({ userPortfolio, formatCurrency, formatPercentage }) => {
  return (
    <Card>
      <h2 className="mb-6 text-xl font-semibold text-white">Your Portfolio</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-medium text-slate-400">Total Balance</h3>
          <p className="mt-2 text-2xl font-bold text-white">
            {formatCurrency(userPortfolio.totalBalance)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-medium text-slate-400">24h Change</h3>
          <p className={`mt-2 text-2xl font-bold ${userPortfolio.dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatPercentage(userPortfolio.dayChange)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
          <h3 className="text-sm font-medium text-slate-400">Total Profit/Loss</h3>
          <p className={`mt-2 text-2xl font-bold ${userPortfolio.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatCurrency(userPortfolio.totalPnL)}
          </p>
        </div>
      </div>
    </Card>
  );
});

export default PortfolioSummary;
