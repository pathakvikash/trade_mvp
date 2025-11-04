import React from 'react';
import styles from '../../styles/globalStyles';

const MarketForecast = React.memo(({ cryptoData, formatCurrency }) => {
  return (
    <div style={styles.dashboardSection}>
      <h2 style={styles.sectionTitle}>Market Forecast</h2>
      <div style={styles.forecastGrid}>
        {cryptoData.slice(0, 3).map((crypto) => (
          <div key={crypto.symbol} style={styles.forecastCard}>
            <div style={styles.forecastHeader}>
              <img 
                src={crypto.icon} 
                alt={crypto.name} 
                style={styles.forecastIcon}
              />
              <h3>{crypto.symbol}</h3>
            </div>
            <div style={styles.forecastContent}>
              <div style={styles.forecastItem}>
                <span>Trend Signal</span>
                <span style={{
                  color: crypto.forecast.trend === 'bullish' ? '#10b981' : '#ef4444'
                }}>
                  {crypto.forecast.trend.toUpperCase()}
                </span>
              </div>
              <div style={styles.forecastItem}>
                <span>Support</span>
                <span>{formatCurrency(crypto.forecast.support)}</span>
              </div>
              <div style={styles.forecastItem}>
                <span>Resistance</span>
                <span>{formatCurrency(crypto.forecast.resistance)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default MarketForecast;
