import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import styles from '../styles/globalStyles';
import useUserStore from '../store/userStore';

const Trade = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, token } = useUserStore((state) => state);
  const [availableCoins, setAvailableCoins] = useState([]);
  const [loading, setLoading] = useState(true);

  const [tradeData, setTradeData] = useState({
    userId: user?.id || '',
    cryptoSymbol: searchParams.get('symbol') || '',
    type: 'buy',
    amount: '',
    priceAtTrade: '',
  });

  const [message, setMessage] = useState({ type: '', text: '' });
  const [selectedCoin, setSelectedCoin] = useState(null);

  useEffect(() => {
    const fetchCoins = async () => {
      try {
        const response = await axios.get(
          'https://api.coingecko.com/api/v3/coins/markets',
          {
            params: {
              vs_currency: 'usd',
              order: 'market_cap_desc',
              per_page: 20,
              page: 1,
            },
          }
        );

        const coins = response.data.map((coin) => ({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          price: coin.current_price,
          image: coin.image,
        }));

        setAvailableCoins(coins);

        // If there's a symbol in the URL, select that coin
        const symbolFromUrl = searchParams.get('symbol');
        if (symbolFromUrl) {
          const coin = coins.find((c) => c.symbol === symbolFromUrl);
          if (coin) {
            setSelectedCoin(coin);
            setTradeData((prev) => ({
              ...prev,
              cryptoSymbol: coin.symbol,
              priceAtTrade: coin.price.toString(),
            }));
          }
        }

        setLoading(false);
      } catch (err) {
        console.error('Error fetching coins:', err);
        // Fallback to dummy data
        const dummyCoins = [
          {
            symbol: 'BTC',
            name: 'Bitcoin',
            price: 39000,
            image:
              'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
          },
          {
            symbol: 'ETH',
            name: 'Ethereum',
            price: 2300,
            image:
              'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
          },
          {
            symbol: 'SOL',
            name: 'Solana',
            price: 98,
            image:
              'https://assets.coingecko.com/coins/images/4128/large/solana.png',
          },
        ];
        setAvailableCoins(dummyCoins);
        setLoading(false);
      }
    };

    fetchCoins();
  }, [searchParams, navigate, user?.id]);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === 'cryptoSymbol') {
      const coin = availableCoins.find((c) => c.symbol === value);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!token) {
        setMessage({ type: 'error', text: 'Please login to trade' });
        navigate('/login');
        return;
      }

      // Ensure userId is included in the request
      const tradePayload = {
        ...tradeData,
        userId: user.id,
      };

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/trades`,
        tradePayload,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (response.data) {
        setMessage({ type: 'success', text: 'Trade executed successfully!' });
        // Reset form except for the selected coin
        setTradeData((prev) => ({
          ...prev,
          amount: '',
          priceAtTrade: selectedCoin ? selectedCoin.price.toString() : '',
        }));
      }
    } catch (err) {
      console.error('Trade error:', err);
      if (err.response?.status === 401) {
        navigate('/login');
      } else {
        setMessage({
          type: 'error',
          text:
            err.response?.data?.message || 'Trade failed. Please try again.',
        });
      }
    }
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}></div>
        <p>Loading trading information...</p>
      </div>
    );
  }

  return (
    <div style={styles.tradeContainer}>
      <div style={styles.tradeCard}>
        <h2 style={styles.tradeHeader}>Execute Trade</h2>

        <form onSubmit={handleSubmit} style={styles.tradeForm}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Select Cryptocurrency</label>
            <select
              name='cryptoSymbol'
              value={tradeData.cryptoSymbol}
              onChange={handleChange}
              style={styles.select}
              required
            >
              <option value=''>Select a coin</option>
              {availableCoins.map((coin) => (
                <option key={coin.symbol} value={coin.symbol}>
                  {coin.name} ({coin.symbol})
                </option>
              ))}
            </select>
          </div>

          {selectedCoin && (
            <div style={styles.selectedCoinInfo}>
              <img
                src={selectedCoin.image}
                alt={selectedCoin.name}
                style={styles.coinIcon}
              />
              <div style={styles.coinDetails}>
                <span style={styles.coinName}>{selectedCoin.name}</span>
                <span style={styles.coinPrice}>
                  Current Price: ${selectedCoin.price.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          <div style={styles.formGroup}>
            <label style={styles.label}>Trade Type</label>
            <select
              name='type'
              value={tradeData.type}
              onChange={handleChange}
              style={styles.select}
              required
            >
              <option value='buy'>Buy</option>
              <option style={styles.select} value='sell'>
                Sell
              </option>
            </select>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Amount</label>
            <input
              type='number'
              name='amount'
              value={tradeData.amount}
              onChange={handleChange}
              placeholder='0.00'
              style={styles.input}
              required
              step='0.000001'
              min='0'
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Price (USD)</label>
            <input
              type='number'
              name='priceAtTrade'
              value={tradeData.priceAtTrade}
              onChange={handleChange}
              placeholder='0.00'
              style={styles.input}
              required
              step='0.01'
              min='0'
            />
            <small style={styles.helperText}>
              Current market price is pre-filled, but you can adjust it for
              limit orders
            </small>
          </div>

          {message.text && (
            <div
              style={
                message.type === 'error'
                  ? styles.errorMessage
                  : styles.successMessage
              }
            >
              {message.text}
            </div>
          )}

          <button
            type='submit'
            style={{
              ...styles.submitButton,
              background: tradeData.type === 'sell' ? 'red' : '#10b981',
            }}
          >
            <span
              style={{
                color: tradeData.type === 'sell' ? 'white' : '',
              }}
            >
              {tradeData.type === 'buy' ? 'Buy Now' : 'Sell Now'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default Trade;
