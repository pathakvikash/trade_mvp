import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import styles from '../styles/globalStyles';
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

// Dummy forecast data
const generateForecast = (price) => ({
  trend: Math.random() > 0.5 ? 'bullish' : 'bearish',
  support: price * 0.95,
  resistance: price * 1.05
});

const Dashboard = () => {
  const [cryptoData, setCryptoData] = useState([]);
  const [userPortfolio, setUserPortfolio] = useState(dummyPortfolio);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchCryptoData = async () => {
      try {
        // Fetch real-time data from CoinGecko API
        const response = await axios.get(
          'https://api.coingecko.com/api/v3/coins/markets',
          {
            params: {
              vs_currency: 'usd',
              order: 'market_cap_desc',
              per_page: 10,
              page: 1,
              sparkline: false,
              price_change_percentage: '24h'
            }
          }
        );

        // Transform CoinGecko data to match our format
        const transformedData = response.data.map(coin => ({
          name: coin.name,
          symbol: coin.symbol.toUpperCase(),
          price: coin.current_price,
          priceChange24h: coin.price_change_percentage_24h,
          marketCap: coin.market_cap,
          icon: coin.image,
          forecast: generateForecast(coin.current_price) // Add dummy forecast
        }));

        setCryptoData(transformedData);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching crypto data:', err);
        // Fallback to dummy data if API fails
        const dummyData = [
          {
            name: 'Bitcoin',
            symbol: 'BTC',
            price: 39876.54,
            priceChange24h: 2.45,
            marketCap: 800456789012,
            icon: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
            forecast: {
              trend: 'bullish',
              support: 38000,
              resistance: 41000
            }
          },
          {
            name: 'Ethereum',
            symbol: 'ETH',
            price: 2345.67,
            priceChange24h: -1.23,
            marketCap: 234567890123,
            icon: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
            forecast: {
              trend: 'bearish',
              support: 2200,
              resistance: 2400
            }
          },
          {
            name: 'Solana',
            symbol: 'SOL',
            price: 98.76,
            priceChange24h: 5.67,
            marketCap: 34567890123,
            icon: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
            forecast: {
              trend: 'bullish',
              support: 95,
              resistance: 105
            }
          }
        ];
        setCryptoData(dummyData);
        setLoading(false);
        setError('Using dummy data due to API error');
      }
    };

    fetchCryptoData();

    // Simulate real-time updates
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

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading your dashboard...</p>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      {error && <div style={{...styles.errorMessage, marginBottom: '20px'}}>{error}</div>}
      
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
