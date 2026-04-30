import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../store/userStore';
import useMarketStore from '../store/marketStore';
import MarketChartPanel from '../components/trade/MarketChartPanel';
import OrderBookPanel from '../components/trade/OrderBookPanel';
import TradeForm from '../components/trade/TradeForm';
import PositionsPanel from '../components/trade/PositionsPanel';
import TradeHistoryPanel from '../components/trade/TradeHistoryPanel';

const Trade = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, token } = useUserStore((state) => state);
  const marketData = useMarketStore((state) => state.marketData);
  const socketStatus = useMarketStore((state) => state.socketStatus);

  const [message, setMessage] = useState({ type: '', text: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tradeData, setTradeData] = useState({
    userId: user?.id || '',
    cryptoSymbol: '',
    type: 'buy',
    amount: '',
    priceAtTrade: '',
    orderType: 'Market',
  });
  const [selectedCoin, setSelectedCoin] = useState(null);

  const availableCoins = useMemo(
    () =>
      marketData.map((coin) => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        image: coin.image,
      })),
    [marketData]
  );

  useEffect(() => {
    if (availableCoins.length === 0) {
      return;
    }

    const symbolFromUrl = searchParams.get('symbol')?.toUpperCase();
    const initialCoin =
      availableCoins.find((coin) => coin.symbol === symbolFromUrl) || availableCoins[0];

    setSelectedCoin(initialCoin);
    setTradeData((prev) => ({
      ...prev,
      userId: user?.id || '',
      cryptoSymbol: initialCoin.symbol,
      priceAtTrade: initialCoin.price.toString(),
    }));
  }, [availableCoins, searchParams, user?.id]);

  const chartData = useMemo(() => {
    if (!selectedCoin) {
      return null;
    }

    const base = selectedCoin.price;
    const labels = Array.from({ length: 12 }, (_, index) => `${12 - index}h`);
    const prices = Array.from({ length: 12 }, (_, index) => {
      const volatility = Math.sin(index / 2) * 0.006 + (Math.random() - 0.5) * 0.002;
      return Number((base * (1 + volatility)).toFixed(2));
    });

    return {
      labels,
      datasets: [
        {
          label: `${selectedCoin.symbol} price`,
          data: prices,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.16)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    };
  }, [selectedCoin]);

  const orderBook = useMemo(() => {
    const price = selectedCoin?.price || 100;
    const spread = selectedCoin ? (price * 0.002).toFixed(2) : '0.00';
    const bids = Array.from({ length: 6 }, (_, index) => {
      const value = Number((price * (1 - 0.0015 - index * 0.0008)).toFixed(2));
      const size = ((index + 1) * 0.18).toFixed(3);
      return { price: value, size, total: `$${(value * Number(size)).toFixed(2)}` };
    });
    const asks = Array.from({ length: 6 }, (_, index) => {
      const value = Number((price * (1 + 0.0015 + index * 0.0008)).toFixed(2));
      const size = ((index + 1) * 0.14).toFixed(3);
      return { price: value, size, total: `$${(value * Number(size)).toFixed(2)}` };
    });
    return { bids, asks, spread: `$${spread}` };
  }, [selectedCoin]);

  const positions = useMemo(() => {
    return availableCoins.slice(0, 3).map((coin, index) => ({
      symbol: coin.symbol,
      description: `${coin.name} trading position`,
      size: `${(index + 0.7).toFixed(3)} ${coin.symbol}`,
      pnl: Number(((Math.random() - 0.3) * 1200).toFixed(2)),
    }));
  }, [availableCoins]);

  const trades = useMemo(() => {
    return availableCoins.slice(0, 4).map((coin, index) => ({
      id: `${coin.symbol}-${index}`,
      symbol: coin.symbol,
      asset: coin.symbol,
      action: index % 2 === 0 ? 'Buy' : 'Sell',
      amount: (Math.random() * 1.8 + 0.1).toFixed(3),
      price: Number((coin.price * (1 + (Math.random() - 0.5) * 0.008)).toFixed(2)),
      time: `${11 + index}:${index * 5 + 10} PM`,
    }));
  }, [availableCoins]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'cryptoSymbol') {
      const coin = availableCoins.find((item) => item.symbol === value);
      setSelectedCoin(coin);
      setTradeData((prev) => ({
        ...prev,
        cryptoSymbol: value,
        priceAtTrade: coin ? coin.price.toString() : '',
      }));
    } else {
      setTradeData((prev) => ({ ...prev, [name]: value }));
    }

    setMessage({ type: '', text: '' });
  };

  const handleTypeChange = (type) => {
    setTradeData((prev) => ({ ...prev, type, orderType: 'Limit' }));
    setMessage({ type: '', text: '' });
  };

  const handleSubmit = async () => {
    if (!token) {
      setMessage({ type: 'error', text: 'Please login to trade.' });
      navigate('/login');
      return;
    }

    setIsSubmitting(true);

    try {
      const tradePayload = {
        ...tradeData,
        userId: user?.id || '',
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL || ''}/api/trades`,
        tradePayload,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response?.data) {
        setMessage({ type: 'success', text: 'Order placed successfully.' });
        setTradeData((prev) => ({
          ...prev,
          amount: '',
          priceAtTrade: selectedCoin?.price?.toString() || '',
        }));
      }
    } catch (error) {
      console.error(error);
      setMessage({
        type: 'error',
        text: error.response?.data?.message || 'Unable to place the order at this time.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLoading = marketData.length === 0 && socketStatus === 'connecting';

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-screen-lg items-center justify-center px-4 text-slate-300">
        <div className="animate-pulse rounded-3xl border border-slate-800 bg-slate-900/80 p-8 text-center">
          <div className="mb-4 h-4 w-40 rounded-full bg-slate-800"></div>
          <div className="space-y-3">
            <div className="h-3 rounded-full bg-slate-800"></div>
            <div className="h-3 rounded-full bg-slate-800"></div>
            <div className="h-3 rounded-full bg-slate-800 w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-[1.75fr_1fr]">
        <MarketChartPanel
          title="Trading View"
          symbol={selectedCoin ? `${selectedCoin.symbol}/USD` : 'BTC/USD'}
          currentPrice={selectedCoin?.price}
          change={selectedCoin?.price ? (Math.random() * 2 - 1) : 0}
          chartData={chartData}
        />
        <OrderBookPanel bids={orderBook.bids} asks={orderBook.asks} spread={orderBook.spread} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <TradeForm
          availableCoins={availableCoins}
          selectedCoin={selectedCoin}
          tradeData={tradeData}
          onChange={handleChange}
          onTypeChange={handleTypeChange}
          onSubmit={handleSubmit}
          message={message}
          isSubmitting={isSubmitting}
        />

        <div className="space-y-5">
          <PositionsPanel positions={positions} />
          <TradeHistoryPanel trades={trades} />
        </div>
      </div>
    </div>
  );
};

export default Trade;
