import React, { useMemo } from 'react';
import styles from '../styles/globalStyles';
import useMarketStore from '../store/marketStore';

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
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading your portfolio...</p>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      {hasError && (
        <div style={{ ...styles.errorMessage, marginBottom: '20px' }}>
          Unable to load market data. Prices may not be current.
        </div>
      )}

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
                  {holding.pnLPercentage.toFixed(2)}%)
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
