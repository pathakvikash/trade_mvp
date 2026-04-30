import React, { useMemo } from 'react';
import useMarketStore from '../store/marketStore';
import Card from '../components/ui/Card';

// Move static data outside component to avoid dependency issues
const holdingsBase = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    amount: 0.5,
    avgBuyPrice: 35000,
    icon: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    amount: 4.2,
    avgBuyPrice: 2000,
    icon: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
  },
];

// Dummy transactions (static)
const transactions = [
  {
    id: 1,
    type: 'buy',
    symbol: 'BTC',
    amount: 0.3,
    price: 34000,
    total: 10200,
    date: '2024-01-15T10:30:00Z',
  },
  {
    id: 2,
    type: 'sell',
    symbol: 'ETH',
    amount: 1.5,
    price: 2100,
    total: 3150,
    date: '2024-01-14T15:45:00Z',
  },
];

const Portfolio = () => {
  const marketData = useMarketStore((state) => state.marketData);
  const socketStatus = useMarketStore((state) => state.socketStatus);

  const holdings = useMemo(() => {
    if (!marketData || marketData.length === 0) {
      return holdingsBase.map(h => ({
        ...h,
        currentPrice: 0,
        value: 0,
        pnL: 0,
        pnLPercentage: 0,
      }));
    }

    return holdingsBase.map(holding => {
      const marketCoin = marketData.find(m => m.symbol.toUpperCase() === holding.symbol.toUpperCase());
      const currentPrice = marketCoin ? marketCoin.current_price : 0;
      const value = holding.amount * currentPrice;
      const costBasis = holding.amount * holding.avgBuyPrice;
      const pnL = value - costBasis;
      const pnLPercentage = costBasis > 0 ? (pnL / costBasis) * 100 : 0;

      return {
        ...holding,
        currentPrice,
        value,
        pnL,
        pnLPercentage,
      };
    });
  }, [marketData]);

  const portfolio = useMemo(() => {
    const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
    const totalCostBasis = holdingsBase.reduce((sum, h) => sum + h.amount * h.avgBuyPrice, 0);
    const totalPnL = totalValue - totalCostBasis;

    return {
      holdings,
      transactions,
      totalValue,
      totalPnL,
    };
  }, [holdings]);

  const isLoading = marketData.length === 0 && socketStatus === 'connecting';
  const hasError = socketStatus === 'error';

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
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
      {hasError && (
        <Card className="border-red-800/50 bg-red-950/20">
          <p className="text-red-300">Unable to load market data. Prices may not be current.</p>
        </Card>
      )}

      {/* Portfolio Summary */}
      <Card>
        <h2 className="mb-6 text-xl font-semibold text-white">Portfolio Summary</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Total Portfolio Value</h3>
            <p className="mt-2 text-2xl font-bold text-white">
              {formatCurrency(portfolio.totalValue)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Total Profit/Loss</h3>
            <p className={`mt-2 text-2xl font-bold ${portfolio.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatCurrency(portfolio.totalPnL)}
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
              {portfolio.holdings.map((holding) => (
                <tr key={holding.symbol} className="hover:bg-slate-900/30">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={holding.icon}
                        alt={holding.name}
                        className="h-8 w-8 rounded-full"
                      />
                      <div>
                        <div className="font-medium text-white">{holding.name}</div>
                        <div className="text-sm text-slate-400">{holding.symbol}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 text-white">{holding.amount}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.avgBuyPrice)}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.currentPrice)}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.value)}</td>
                  <td className={`py-4 ${holding.pnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(holding.pnL)}
                    <span className="text-sm">
                      ({holding.pnL >= 0 ? '+' : ''}{holding.pnLPercentage.toFixed(2)}%)
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card >

      {/* Recent Transactions */}
      < Card >
        <h2 className="mb-6 text-xl font-semibold text-white">Recent Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Type</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Asset</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Amount</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Price</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Total</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {portfolio.transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-900/30">
                  <td className={`py-4 font-medium capitalize ${tx.type === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {tx.type}
                  </td>
                  <td className="py-4 text-white">{tx.symbol}</td>
                  <td className="py-4 text-white">{tx.amount}</td>
                  <td className="py-4 text-white">{formatCurrency(tx.price)}</td>
                  <td className="py-4 text-white">{formatCurrency(tx.total)}</td>
                  <td className="py-4 text-white">{formatDate(tx.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card >
    </div >
  );
};

export default Portfolio;
