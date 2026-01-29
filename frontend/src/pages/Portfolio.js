import React, { useState, useEffect } from 'react';
import styles from '../styles/globalStyles';

const Portfolio = () => {
  const [portfolio, setPortfolio] = useState({
    holdings: [],
    transactions: [],
    totalValue: 0,
    totalPnL: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchPortfolioData = async () => {
      try {
        // For now, using dummy data
        const dummyData = {
          holdings: [
            {
              symbol: 'BTC',
              name: 'Bitcoin',
              amount: 0.5,
              avgBuyPrice: 35000,
              currentPrice: 39000,
              value: 19500,
              pnL: 2000,
              pnLPercentage: 11.43,
              icon: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
            },
            {
              symbol: 'ETH',
              name: 'Ethereum',
              amount: 4.2,
              avgBuyPrice: 2000,
              currentPrice: 2300,
              value: 9660,
              pnL: 1260,
              pnLPercentage: 15,
              icon: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
            },
          ],
          transactions: [
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
          ],
          totalValue: 29160,
          totalPnL: 3260,
        };

        setPortfolio(dummyData);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching portfolio:', err);
        setError('Failed to load portfolio data');
        setLoading(false);
      }
    };

    fetchPortfolioData();
  }, []);

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

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading your portfolio...</p>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      {error && <div style={styles.errorMessage}>{error}</div>}

      {/* Portfolio Summary */}
      <div style={styles.dashboardSection}>
        <h2 style={styles.sectionTitle}>Portfolio Summary</h2>
        <div style={styles.portfolioGrid}>
          <div style={styles.portfolioCard}>
            <h3>Total Portfolio Value</h3>
            <p style={styles.portfolioValue}>
              {formatCurrency(portfolio.totalValue)}
            </p>
          </div>
          <div style={styles.portfolioCard}>
            <h3>Total Profit/Loss</h3>
            <p
              style={{
                ...styles.portfolioValue,
                color: portfolio.totalPnL >= 0 ? '#10b981' : '#ef4444',
              }}
            >
              {formatCurrency(portfolio.totalPnL)}
            </p>
          </div>
        </div>
      </div>

      {/* Holdings */}
      <div style={styles.dashboardSection}>
        <h2 style={styles.sectionTitle}>Your Holdings</h2>
        <div style={styles.cryptoTable}>
          <div style={styles.tableHeader}>
            <div style={styles.tableHeaderCell}>Asset</div>
            <div style={styles.tableHeaderCell}>Amount</div>
            <div style={styles.tableHeaderCell}>Avg Buy Price</div>
            <div style={styles.tableHeaderCell}>Current Price</div>
            <div style={styles.tableHeaderCell}>Value</div>
            <div style={styles.tableHeaderCell}>P/L</div>
          </div>
          {portfolio.holdings.map((holding) => (
            <div key={holding.symbol} style={styles.tableRow}>
              <div style={styles.tableCell}>
                <div style={styles.cryptoInfo}>
                  <img
                    src={holding.icon}
                    alt={holding.name}
                    style={styles.cryptoIcon}
                  />
                  <div>
                    <div style={styles.cryptoName}>{holding.name}</div>
                    <div style={styles.cryptoSymbol}>{holding.symbol}</div>
                  </div>
                </div>
              </div>
              <div style={styles.tableCell}>{holding.amount}</div>
              <div style={styles.tableCell}>
                {formatCurrency(holding.avgBuyPrice)}
              </div>
              <div style={styles.tableCell}>
                {formatCurrency(holding.currentPrice)}
              </div>
              <div style={styles.tableCell}>
                {formatCurrency(holding.value)}
              </div>
              <div
                style={{
                  ...styles.tableCell,
                  color: holding.pnL >= 0 ? '#10b981' : '#ef4444',
                }}
              >
                {formatCurrency(holding.pnL)}
                <span style={styles.pnlPercentage}>
                  ({holding.pnL >= 0 ? '+' : ''}
                  {holding.pnLPercentage}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <div style={styles.dashboardSection}>
        <h2 style={styles.sectionTitle}>Recent Transactions</h2>
        <div style={styles.cryptoTable}>
          <div style={styles.tableHeader}>
            <div style={styles.tableHeaderCell}>Type</div>
            <div style={styles.tableHeaderCell}>Asset</div>
            <div style={styles.tableHeaderCell}>Amount</div>
            <div style={styles.tableHeaderCell}>Price</div>
            <div style={styles.tableHeaderCell}>Total</div>
            <div style={styles.tableHeaderCell}>Date</div>
          </div>
          {portfolio.transactions.map((tx) => (
            <div key={tx.id} style={styles.tableRow}>
              <div
                style={{
                  ...styles.tableCell,
                  color: tx.type === 'buy' ? '#10b981' : '#ef4444',
                  textTransform: 'capitalize',
                }}
              >
                {tx.type}
              </div>
              <div style={styles.tableCell}>{tx.symbol}</div>
              <div style={styles.tableCell}>{tx.amount}</div>
              <div style={styles.tableCell}>{formatCurrency(tx.price)}</div>
              <div style={styles.tableCell}>{formatCurrency(tx.total)}</div>
              <div style={styles.tableCell}>{formatDate(tx.date)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Portfolio;
