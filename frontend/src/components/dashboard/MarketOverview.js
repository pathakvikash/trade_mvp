import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from '../../styles/globalStyles';

const MarketOverview = React.memo(({ cryptoData, formatCurrency, formatPercentage, formatMarketCap }) => {
  const navigate = useNavigate();

  return (
    <div style={styles.dashboardSection}>
      <h2 style={styles.sectionTitle}>Market Overview</h2>
      <div style={styles.cryptoTable}>
        <div style={styles.tableHeader}>
          <div style={styles.tableHeaderCell}>Asset</div>
          <div style={styles.tableHeaderCell}>Price</div>
          <div style={styles.tableHeaderCell}>24h Change</div>
          <div style={styles.tableHeaderCell}>Market Cap</div>
          <div style={styles.tableHeaderCell}>Action</div>
        </div>
        {cryptoData.map((crypto) => (
          <div key={crypto.symbol} style={styles.tableRow}>
            <div style={styles.tableCell}>
              <div style={styles.cryptoInfo}>
                <img 
                  src={crypto.icon} 
                  alt={crypto.name} 
                  style={styles.cryptoIcon}
                />
                <div>
                  <div style={styles.cryptoName}>{crypto.name}</div>
                  <div style={styles.cryptoSymbol}>{crypto.symbol}</div>
                </div>
              </div>
            </div>
            <div style={styles.tableCell}>
              {formatCurrency(crypto.price)}
            </div>
            <div style={{
              ...styles.tableCell,
              color: crypto.priceChange24h >= 0 ? '#10b981' : '#ef4444'
            }}>
              {formatPercentage(crypto.priceChange24h)}
            </div>
            <div style={styles.tableCell}>
              {formatMarketCap(crypto.marketCap)}
            </div>
            <div style={styles.tableCell}>
              <button 
                onClick={() => navigate(`/trade?symbol=${crypto.symbol}`)}
                style={styles.tradeButton}
              >
                Trade
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default MarketOverview;
