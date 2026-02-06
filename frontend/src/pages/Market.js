import React, { useState, useEffect, useCallback } from 'react';
import useMarketStore from '../store/marketStore';
import { Line } from 'react-chartjs-2';
import axios from 'axios';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/24/solid';
import styles from '../styles/globalStyles';
import CandlestickChart from '../CandlestickChart';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const Market = () => {
  const [timeframe, setTimeframe] = useState('1'); // Default to 1 day for OHLC
  const [selectedCoin, setSelectedCoin] = useState('bitcoin');
  const [chartData, setChartData] = useState(null);
  const [candlestickData, setCandlestickData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [newAlert, setNewAlert] = useState({
    coin: '',
    type: 'price',
    condition: 'above',
    value: '',
  });
  const [chartType, setChartType] = useState('line'); // 'line' or 'candlestick'

  // Subscribe to market store
  const marketData = useMarketStore((state) => state.marketData);
  const socketStatus = useMarketStore((state) => state.socketStatus);
  const lastUpdate = useMarketStore((state) => state.lastUpdate);

  // CoinGecko /ohlc endpoint only supports 1, 7, 14, 30, 90, 180, 365, max days
  const availableTimeframes = [
    { label: '24h', value: '1' },
    { label: '7d', value: '7' },
    { label: '14d', value: '14' },
    { label: '30d', value: '30' },
    { label: '90d', value: '90' },
    { label: '180d', value: '180' },
    { label: '1y', value: '365' },
    { label: 'Max', value: 'max' },
  ];

  const fetchMarketData = useCallback(async () => {
    try {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets',
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: 20,
            sparkline: false,
          },
        }
      );
      useMarketStore.getState().setMarketData(response.data);
    } catch (err) {
      setError('Failed to fetch market data');
      console.error(err);
    }
  }, []);

  const fetchChartData = useCallback(async () => {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${selectedCoin}/market_chart`,
        {
          params: {
            vs_currency: 'usd',
            days: timeframe,
          },
        }
      );

      const prices = response.data.prices;
      const labels = prices.map((price) =>
        new Date(price[0]).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: timeframe === '1' ? 'numeric' : undefined,
        })
      );

      setChartData({
        labels,
        datasets: [
          {
            label: selectedCoin.charAt(0).toUpperCase() + selectedCoin.slice(1),
            data: prices.map((price) => price[1]),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHitRadius: 20,
          },
        ],
      });
      setLoading(false);
    } catch (err) {
      setError('Failed to fetch chart data');
      console.error(err);
    }
  }, [selectedCoin, timeframe]);

  const fetchCandlestickData = useCallback(async () => {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${selectedCoin}/ohlc`,
        {
          params: {
            vs_currency: 'usd',
            days: timeframe, // Use the selected timeframe directly
          },
        }
      );

      const ohlcData = response.data.map((d) => ({
        date: new Date(d[0]),
        open: d[1],
        high: d[2],
        low: d[3],
        close: d[4],
      }));
      setCandlestickData(ohlcData);
    } catch (err) {
      setError('Failed to fetch candlestick data');
      console.error(err);
    }
  }, [selectedCoin, timeframe]);

  useEffect(() => {
    // Fallback to polling if socket disconnects or stops sending updates
    const interval = setInterval(() => {
      const now = Date.now();
      const stale = now - lastUpdate > 35000;
      if (socketStatus !== 'connected' || stale) {
        fetchMarketData();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchMarketData, socketStatus, lastUpdate]);

  useEffect(() => {
    fetchMarketData();
    fetchChartData();
    if (chartType === 'candlestick') {
      fetchCandlestickData();
    }
  }, [selectedCoin, timeframe, chartType, fetchMarketData, fetchChartData, fetchCandlestickData]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (context) => `$${context.parsed.y.toLocaleString()}`,
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
      },
      y: {
        grid: {
          color: 'rgba(0, 0, 0, 0.05)',
        },
        ticks: {
          callback: (value) => `$${value.toLocaleString()}`,
        },
      },
    },
    interaction: {
      intersect: false,
      mode: 'index',
    },
  };

  const handleCreateAlert = (e) => {
    e.preventDefault();
    setAlerts([...alerts, { ...newAlert, id: Date.now() }]);
    setNewAlert({
      coin: '',
      type: 'price',
      condition: 'above',
      value: '',
    });
    setShowAlertForm(false);
  };

  const handleRemoveAlert = (alertId) => {
    setAlerts(alerts.filter((alert) => alert.id !== alertId));
  };

  const handleTimeframeClick = (tf) => {
    setTimeframe(tf);
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading market data...</p>
      </div>
    );
  }

  return (
    <div className='container mx-auto px-4 py-6'>
      {error && <div style={styles.errorMessage}>{error}</div>}

      <div style={styles.marketHeader}>
        <div style={styles.marketHeaderTop}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h1 style={styles.marketTitle}>Crypto Market</h1>
            <div style={{ marginLeft: 12, display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  display: 'inline-block',
                  marginRight: 8,
                  backgroundColor:
                    socketStatus === 'connected'
                      ? '#10b981'
                      : socketStatus === 'connecting'
                      ? '#f59e0b'
                      : '#ef4444',
                }}
              ></span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>{socketStatus}</span>
            </div>
          </div>
          <div style={styles.timeframeControls}>
            <div style={styles.timeframeSelector}>
              {availableTimeframes.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => handleTimeframeClick(tf.value)}
                  style={{
                    ...styles.timeframeButton,
                    backgroundColor:
                      timeframe === tf.value ? '#2563eb' : 'transparent',
                    color: timeframe === tf.value ? 'white' : '#2563eb',
                  }}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <div className="chart-type-toggle ml-4">
              <button
                onClick={() => setChartType('line')}
                style={{
                  ...styles.timeframeButton,
                  backgroundColor: chartType === 'line' ? '#2563eb' : 'transparent',
                  color: chartType === 'line' ? 'white' : '#2563eb',
                }}
              >
                Line
              </button>
              <button
                onClick={() => setChartType('candlestick')}
                style={{
                  ...styles.timeframeButton,
                  backgroundColor: chartType === 'candlestick' ? '#2563eb' : 'transparent',
                  color: chartType === 'candlestick' ? 'white' : '#2563eb',
                  marginLeft: '8px',
                }}
              >
                Candlestick
              </button>
            </div>
          </div>
        </div>

        <div style={styles.alertSection}>
          <button
            onClick={() => setShowAlertForm(true)}
            style={styles.createAlertButton}
          >
            + Create Alert
          </button>

          {showAlertForm && (
            <div style={styles.alertFormOverlay}>
              <div style={styles.alertForm}>
                <h3 style={styles.alertFormTitle}>Create Price Alert</h3>
                <form onSubmit={handleCreateAlert}>
                  <div style={styles.alertFormGroup}>
                    <label>Cryptocurrency</label>
                    <select
                      value={newAlert.coin}
                      onChange={(e) =>
                        setNewAlert({ ...newAlert, coin: e.target.value })
                      }
                      required
                      style={styles.alertSelect}
                    >
                      <option value=''>Select Coin</option>
                      {marketData.map((coin) => (
                        <option key={coin.id} value={coin.symbol}>
                          {coin.name} ({coin.symbol.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={styles.alertFormGroup}>
                    <label>Alert Type</label>
                    <select
                      value={newAlert.type}
                      onChange={(e) =>
                        setNewAlert({ ...newAlert, type: e.target.value })
                      }
                      style={styles.alertSelect}
                    >
                      <option value='price'>Price Alert</option>
                      <option value='change'>24h Change Alert</option>
                    </select>
                  </div>

                  <div style={styles.alertFormGroup}>
                    <label>Condition</label>
                    <select
                      value={newAlert.condition}
                      onChange={(e) =>
                        setNewAlert({ ...newAlert, condition: e.target.value })
                      }
                      style={styles.alertSelect}
                    >
                      <option value='above'>Goes Above</option>
                      <option value='below'>Goes Below</option>
                    </select>
                  </div>

                  <div style={styles.alertFormGroup}>
                    <label>Value</label>
                    <input
                      type='number'
                      value={newAlert.value}
                      onChange={(e) =>
                        setNewAlert({ ...newAlert, value: e.target.value })
                      }
                      placeholder={
                        newAlert.type === 'price'
                          ? 'Enter price'
                          : 'Enter percentage'
                      }
                      required
                      style={styles.alertInput}
                    />
                  </div>

                  <div style={styles.alertFormButtons}>
                    <button type='submit' style={styles.alertSubmitButton}>
                      Create Alert
                    </button>
                    <button
                      type='button'
                      onClick={() => setShowAlertForm(false)}
                      style={styles.alertCancelButton}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {alerts.length > 0 && (
            <div style={styles.activeAlerts}>
              {alerts.map((alert) => (
                <div key={alert.id} style={styles.alertItem}>
                  <span style={styles.alertText}>
                    {alert.coin.toUpperCase()}{' '}
                    {alert.type === 'price' ? 'Price' : '24h Change'}{' '}
                    {alert.condition} {alert.type === 'price' ? '$' : ''}
                    {alert.value}
                    {alert.type === 'change' && '%'}
                  </span>
                  <button
                    onClick={() => handleRemoveAlert(alert.id)}
                    style={styles.alertRemoveButton}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.marketGrid}>
        <div style={styles.chartCard}>
          {chartType === 'line' && chartData && (
            <div style={styles.chartContainer}>
              <Line data={chartData} options={chartOptions} />
            </div>
          )}
          {chartType === 'candlestick' && candlestickData && (
            <div style={styles.chartContainer}>
              <CandlestickChart data={candlestickData} />
            </div>
          )}
        </div>

        <div style={styles.marketList}>
          {marketData.map((coin) => (
            <div
              key={coin.id}
              onClick={() => setSelectedCoin(coin.id)}
              style={{
                ...styles.coinItem,
                backgroundColor:
                  selectedCoin === coin.id
                    ? 'rgba(37, 99, 235, 0.1)'
                    : 'transparent',
              }}
            >
              <div style={styles.coinInfo}>
                <img src={coin.image} alt={coin.name} style={styles.coinIcon} />
                <div style={styles.coinDetails}>
                  <span style={styles.coinName}>{coin.name}</span>
                  <span style={styles.coinSymbol}>
                    {coin.symbol.toUpperCase()}
                  </span>
                </div>
              </div>
              <div style={styles.coinPrice}>
                <span style={styles.currentPrice}>
                  ${coin.current_price.toLocaleString()}
                </span>
                <span
                  style={{
                    ...styles.priceChange,
                    color:
                      coin.price_change_percentage_24h >= 0
                        ? '#10b981'
                        : '#ef4444',
                  }}
                >
                  {coin.price_change_percentage_24h >= 0 ? (
                    <ArrowUpIcon style={styles.changeIcon} />
                  ) : (
                    <ArrowDownIcon style={styles.changeIcon} />
                  )}
                  {Math.abs(coin.price_change_percentage_24h).toFixed(2)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Market;
