import React from 'react';
import styles from '../../styles/globalStyles';

const PortfolioSummary = React.memo(({ userPortfolio, formatCurrency, formatPercentage }) => {
  return (
    <div style={styles.dashboardSection}>
      <h2 style={styles.sectionTitle}>Your Portfolio</h2>
      <div style={styles.portfolioGrid}>
        <div style={styles.portfolioCard}>
          <h3>Total Balance</h3>
          <p style={styles.portfolioValue}>
            {formatCurrency(userPortfolio.totalBalance)}
          </p>
        </div>
        <div style={styles.portfolioCard}>
          <h3>24h Change</h3>
          <p style={{
            ...styles.portfolioValue,
            color: userPortfolio.dayChange >= 0 ? '#10b981' : '#ef4444'
          }}>
            {formatPercentage(userPortfolio.dayChange)}
          </p>
        </div>
        <div style={styles.portfolioCard}>
          <h3>Total Profit/Loss</h3>
          <p style={{
            ...styles.portfolioValue,
            color: userPortfolio.totalPnL >= 0 ? '#10b981' : '#ef4444'
          }}>
            {formatCurrency(userPortfolio.totalPnL)}
          </p>
        </div>
      </div>
    </div>
  );
});

export default PortfolioSummary;
