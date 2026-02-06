import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styles from '../styles/globalStyles';
import useMarketStore from '../store/marketStore';
import PortfolioSummary from '../components/dashboard/PortfolioSummary';
import MarketOverview from '../components/dashboard/MarketOverview';
import MarketForecast from '../components/dashboard/MarketForecast';

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
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading your dashboard...</p>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      {hasError && (
        <div style={{ ...styles.errorMessage, marginBottom: '20px' }}>
          Unable to connect to market data. Some features may be limited.
        </div>
      )}

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
  );
};

export default Dashboard;
