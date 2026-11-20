import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../store/userStore';
import useMarketStore from '../store/marketStore';
import usePolling from '../lib/usePolling';
import usePortfolio from '../lib/usePortfolio';
import { API, authed } from '../lib/api';
import { fmtPrice } from '../components/ui/fmt';
import { FUT, coin as baseOf } from '../components/liquidation/shared';
import useFuturesStore from '../store/futuresStore';
import SegTabs from '../components/ui/SegTabs';
import SymbolHeader from '../components/trade/SymbolHeader';
import MarketChartPanel from '../components/trade/MarketChartPanel';
import OrderBookPanel from '../components/trade/OrderBookPanel';
import TradesTapePanel from '../components/trade/TradesTapePanel';
import TradeForm from '../components/trade/TradeForm';
import BottomStrip from '../components/trade/BottomStrip';

const MOBILE_TABS = [{ id: 'order', label: 'Order' }, { id: 'book', label: 'Book' }, { id: 'trades', label: 'Trades' }];

const Trade = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = useUserStore((s) => s.token);
  const prefSymbol = useUserStore((s) => s.user?.preferences?.defaultSymbol);
  const defaultTf = useUserStore((s) => s.user?.preferences?.defaultTimeframe) || '1m';
  const marketData = useMarketStore((s) => s.marketData);
  const account = usePortfolio(token);

  const [message, setMessage] = useState({ type: '', text: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mobileTab, setMobileTab] = useState('order');

  const availableCoins = useMemo(
    () =>
      marketData.map((coin) => ({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change: coin.price_change_percentage_24h,
      })),
    [marketData]
  );

  // The futures symbol comes from the URL, else the user's default pair (Settings), else BTC; CoinGecko data is only decoration when it has the coin.
  const urlSymbol = searchParams.get('symbol')?.toUpperCase();
  const prefBase = prefSymbol?.replace(/USDT$/, '').toUpperCase();
  const symbol = [urlSymbol, prefBase].find((s) => s && /^[A-Z0-9]{2,20}$/.test(s)) || 'BTC';
  const futuresSymbol = `${symbol}USDT`;
  const cg = useMemo(() => availableCoins.find((c) => c.symbol === symbol), [availableCoins, symbol]);

  const ov = usePolling(`${FUT}/overview`, 15000);
  const overview = useMemo(() => (Array.isArray(ov.data) ? ov.data : []), [ov.data]);
  // base symbol -> futures last price, for position P&L (overview covers the top-40 perps only)
  const prices = useMemo(() => Object.fromEntries(overview.map((r) => [baseOf(r.symbol), r.lastPrice ?? r.markPrice])), [overview]);
  const symbols = useMemo(() => {
    const list = overview.length ? overview.map((r) => baseOf(r.symbol)) : availableCoins.map((c) => c.symbol);
    return list.includes(symbol) ? list : [symbol, ...list];
  }, [overview, availableCoins, symbol]);
  const candles = useFuturesStore((s) => s.candles);
  const book = useFuturesStore((s) => s.book);
  const mark = useFuturesStore((s) => s.mark);
  const trades = useFuturesStore((s) => s.trades);
  const interval = useFuturesStore((s) => s.interval);
  const futuresError = useFuturesStore((s) => s.error);
  const storeSymbol = useFuturesStore((s) => s.symbol);
  const subscribe = useFuturesStore((s) => s.subscribe);
  const unsubscribe = useFuturesStore((s) => s.unsubscribe);
  const setTimeframe = useFuturesStore((s) => s.setTimeframe);

  useEffect(() => {
    if (futuresSymbol) subscribe(futuresSymbol, defaultTf);
  }, [futuresSymbol, subscribe, defaultTf]);
  useEffect(() => unsubscribe, [unsubscribe]);

  const ready = storeSymbol === futuresSymbol;
  const reloadSeq = useFuturesStore((s) => s.reloadSeq);
  // Futures last price (last candle close, else mark); never the CoinGecko spot price.
  const lastPrice = ready ? (candles.length ? candles[candles.length - 1].close : mark?.markPrice ?? null) : null;

  // The server fills at its own mark price; only {cryptoSymbol, type, amount} is sent (the user comes from the token).
  const handleSubmit = async ({ type, amount }) => {
    setMessage({ type: '', text: '' });
    if (!token) {
      setMessage({ type: 'error', text: 'Please login to trade.' });
      navigate('/login');
      return false;
    }

    setIsSubmitting(true);
    try {
      const { data } = await axios.post(`${API}/api/trades`, { cryptoSymbol: symbol, type, amount: Number(amount) }, authed(token));
      const f = data.fill;
      setMessage({
        type: 'success',
        text: `${type === 'buy' ? 'Bought' : 'Sold'} ${f.amount} ${f.symbol} @ ${fmtPrice(f.price)}. Fee $${fmtPrice(f.fee)}. Balance $${fmtPrice(data.balance)}.`,
      });
      account.reload();
      return true;
    } catch (error) {
      console.error(error.message); // the axios error object carries the Authorization header
      const status = error.response?.status;
      setMessage({
        type: 'error',
        text: (status === 429 ? 'Too many orders, slow down.' : null) || error.response?.data?.message || 'Unable to place the order at this time.',
      });
    } finally {
      setIsSubmitting(false);
    }
    return false;
  };

  const show = (tab) => (mobileTab === tab ? '' : 'hidden xl:flex');

  return (
    <div className="space-y-3">
      <SymbolHeader
        symbols={symbols}
        symbol={symbol}
        overview={overview}
        change={cg?.change}
        futuresSymbol={futuresSymbol}
        ready={ready}
        candles={candles}
        mark={mark}
        onSymbol={(s) => setSearchParams({ symbol: s }, { replace: true })}
      />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px_300px] xl:grid-rows-[1fr_auto]">
        <MarketChartPanel
          className="h-[420px] xl:col-start-1 xl:row-start-1 xl:h-auto"
          ticker={symbol}
          interval={interval}
          onInterval={setTimeframe}
          candles={candles}
          reloadSeq={reloadSeq}
          error={futuresError}
          ready={ready}
          onRetry={() => subscribe(futuresSymbol, interval)}
        />

        <SegTabs tabs={MOBILE_TABS} active={mobileTab} onChange={setMobileTab} label="Trading panels" className="xl:hidden" />

        <div className={`${mobileTab === 'order' ? 'hidden xl:flex' : 'flex'} flex-col gap-3 xl:col-start-2 xl:row-span-2 xl:row-start-1`}>
          <OrderBookPanel
            className={show('book')}
            book={book}
            loading={ready && !book && !futuresError}
          />
          <TradesTapePanel className={`${show('trades')} flex-1`} trades={trades} />
        </div>

        <div className={`${mobileTab === 'order' ? '' : 'hidden xl:block'} xl:col-start-3 xl:row-span-2 xl:row-start-1`}>
          <TradeForm
            key={symbol}
            coin={{ symbol, price: lastPrice }}
            balance={account.balance}
            onSubmit={handleSubmit}
            message={message}
            isSubmitting={isSubmitting}
          />
        </div>

        <BottomStrip className="xl:col-start-1 xl:row-start-2" symbol={futuresSymbol} account={account} prices={prices} />
      </div>
    </div>
  );
};

export default Trade;
