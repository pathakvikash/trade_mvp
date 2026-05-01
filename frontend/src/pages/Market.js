import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';
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

  useEffect(() => {
    if (!showAlertForm) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showAlertForm]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-950">
        <Card className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent mx-auto"></div>
          <p className="text-slate-300">Loading market data...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-0 bg-slate-950 p-4 md:p-6">
      {error && (
        <Card className="mb-6 border-red-800/50 bg-red-950/20">
          <p className="text-red-300">{error}</p>
        </Card>
      )}

      <Card className="mb-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">Crypto Market</h1>
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${socketStatus === 'connected'
                ? 'bg-emerald-400'
                : socketStatus === 'connecting'
                  ? 'bg-yellow-400'
                  : 'bg-red-400'
                }`}></div>
              <span className="text-sm text-slate-400 capitalize">{socketStatus}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl border border-slate-800 bg-slate-900/50 p-1">
              {availableTimeframes.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => handleTimeframeClick(tf.value)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${timeframe === tf.value
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-2xl border border-slate-800 bg-slate-900/50 p-1">
              <button
                onClick={() => setChartType('line')}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${chartType === 'line'
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
              >
                Line
              </button>
              <button
                onClick={() => setChartType('candlestick')}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${chartType === 'candlestick'
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
              >
                Candlestick
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => setShowAlertForm(true)}>
            + Create Alert
          </Button>
        </div>

        {showAlertForm && createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4">
            <Card className="z-[121] w-full max-w-md border-slate-700 bg-slate-900/95 shadow-2xl">
              <h3 className="mb-4 text-lg font-semibold text-white">Create Price Alert</h3>
              <form onSubmit={handleCreateAlert} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Cryptocurrency</label>
                  <Select
                    value={newAlert.coin}
                    onChange={(e) => setNewAlert({ ...newAlert, coin: e.target.value })}
                    required
                  >
                    <option value=''>Select Coin</option>
                    {marketData.map((coin) => (
                      <option key={coin.id} value={coin.symbol}>
                        {coin.name} ({coin.symbol.toUpperCase()})
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Alert Type</label>
                  <Select
                    value={newAlert.type}
                    onChange={(e) => setNewAlert({ ...newAlert, type: e.target.value })}
                  >
                    <option value="price">Price Alert</option>
                    <option value="change">Percentage Change</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Condition</label>
                  <Select
                    value={newAlert.condition}
                    onChange={(e) => setNewAlert({ ...newAlert, condition: e.target.value })}
                  >
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Value</label>
                  <Input
                    type="number"
                    value={newAlert.value}
                    onChange={(e) => setNewAlert({ ...newAlert, value: e.target.value })}
                    placeholder={newAlert.type === 'price' ? 'Enter price' : 'Enter percentage'}
                    required
                  />
                </div>

                <div className="flex gap-3">
                  <Button type="submit" className="flex-1">
                    Create Alert
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAlertForm(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Card>
          </div>,
          document.body
        )}

        {alerts.length > 0 && (
          <Card>
            <h4 className="mb-4 text-lg font-semibold text-white">Active Alerts</h4>
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div key={alert.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
                  <span className="text-sm text-slate-300">
                    {alert.coin.toUpperCase()} {alert.condition} {alert.value}
                    {alert.type === 'change' && '%'}
                  </span>
                  <button
                    onClick={() => handleRemoveAlert(alert.id)}
                    className="rounded-full border border-slate-800 bg-slate-900 p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <div className="h-96">
              {chartType === 'line' && chartData && (
                <Line data={chartData} options={chartOptions} />
              )}
              {chartType === 'candlestick' && candlestickData && (
                <CandlestickChart data={candlestickData} />
              )}
            </div>
          </Card>
        </div>

        <div className="hide-scrollbar space-y-2 max-h-[38rem] overflow-y-auto pr-1">
          {marketData.map((coin) => (
            <div
              key={coin.id}
              onClick={() => setSelectedCoin(coin.id)}
              className={`cursor-pointer rounded-2xl border p-4 transition hover:bg-slate-900/50 ${selectedCoin === coin.id
                ? 'border-brand-500 bg-brand-950/20'
                : 'border-slate-800 bg-slate-900/50'
                }`}
            >
              <div className="flex items-center gap-3">
                <img src={coin.image} alt={coin.name} className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <div className="font-medium text-white">{coin.name}</div>
                  <div className="text-sm text-slate-400">{coin.symbol.toUpperCase()}</div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-white">
                    ${coin.current_price?.toFixed(2)}
                  </div>
                  <div className={`text-sm ${coin.price_change_percentage_24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                    {coin.price_change_percentage_24h?.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div >
  );
};

export default Market;
