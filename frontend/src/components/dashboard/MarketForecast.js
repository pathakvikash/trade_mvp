import React from 'react';
import styles from '../../styles/globalStyles';

const MarketForecast = React.memo(({ cryptoData, formatCurrency }) => {
  // Calculate forecast dynamically based on current price
  const calculateForecast = (price) => ({
    trend: Math.random() > 0.5 ? 'bullish' : 'bearish',
    support: price * 0.95,
    resistance: price * 1.05,
  });

  return (
    <div style={styles.dashboardSection}>
      <h2 style={styles.sectionTitle}>Market Forecast</h2>
      <div style={styles.forecastGrid}>
        {cryptoData.slice(0, 3).map((crypto) => {
          const forecast = calculateForecast(crypto.price);
          return (
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
                  <span>Current Price</span>
                  <span>{formatCurrency(crypto.price)}</span>
                </div>
                <div style={styles.forecastItem}>
                  <span>Trend Signal</span>
                  <span style={{
                    color: forecast.trend === 'bullish' ? '#10b981' : '#ef4444'
                  }}>
                    {forecast.trend.toUpperCase()}
                  </span>
                </div>
                <div style={styles.forecastItem}>
                  <span>Support</span>
                  <span>{formatCurrency(forecast.support)}</span>
                </div>
                <div style={styles.forecastItem}>
                  <span>Resistance</span>
                  <span>{formatCurrency(forecast.resistance)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default MarketForecast;
