import React, { useState, useEffect, useCallback, useMemo } from 'react';
import useMarketStore from '../store/marketStore';
import PortfolioSummary from '../components/dashboard/PortfolioSummary';
import MarketOverview from '../components/dashboard/MarketOverview';
import MarketForecast from '../components/dashboard/MarketForecast';
import Card from '../components/ui/Card';

// Dummy portfolio data
const dummyPortfolio = {
  totalBalance: 45678.90,
  dayChange: 2.34,
  totalPnL: 1234.56,
  holdings: [
    { coin: 'BTC', amount: 0.5, value: 20000 },
    { coin: 'ETH', amount: 4.2, value: 8000 },
    { coin: 'SOL', amount: 45, value: 4500 }
  ]
};

const Dashboard = () => {
  const marketData = useMarketStore((state) => state.marketData);
  const socketStatus = useMarketStore((state) => state.socketStatus);
  const [userPortfolio, setUserPortfolio] = useState(dummyPortfolio);

  const cryptoData = useMemo(() => {
    if (!marketData || marketData.length === 0) {
      return [];
    }
    return marketData.slice(0, 10).map(coin => ({
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      price: coin.current_price,
      priceChange24h: coin.price_change_percentage_24h,
      marketCap: coin.market_cap,
      icon: coin.image
    }));
  }, [marketData]);

  const isLoading = cryptoData.length === 0 && socketStatus === 'connecting';
  const hasError = socketStatus === 'error';

  useEffect(() => {
    const interval = setInterval(() => {
      setUserPortfolio(prev => ({
        ...prev,
        dayChange: prev.dayChange + (Math.random() - 0.5) * 0.1,
        totalBalance: prev.totalBalance + (Math.random() - 0.5) * 100
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const formatCurrency = useCallback((value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }, []);

  const formatPercentage = useCallback((value) => {
    return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  }, []);

  const formatMarketCap = useCallback((value) => {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    return formatCurrency(value);
  }, [formatCurrency]);

  if (isLoading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-950">
        <Card className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent mx-auto"></div>
          <p className="text-slate-300">Loading your dashboard...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 bg-slate-950 p-4 md:p-6">
      {hasError && (
        <Card className="mb-6 border-red-800/50 bg-red-950/20">
          <p className="text-red-300">Unable to connect to market data. Some features may be limited.</p>
        </Card>
      )}

      <div className="mx-auto max-w-screen-2xl space-y-6">
        <PortfolioSummary
          userPortfolio={userPortfolio}
          formatCurrency={formatCurrency}
          formatPercentage={formatPercentage}
        />

        <MarketOverview
          cryptoData={cryptoData}
          formatCurrency={formatCurrency}
          formatPercentage={formatPercentage}
          formatMarketCap={formatMarketCap}
        />

        <MarketForecast
          cryptoData={cryptoData}
          formatCurrency={formatCurrency}
        />
      </div>
    </div>
  );
};

export default Dashboard;
