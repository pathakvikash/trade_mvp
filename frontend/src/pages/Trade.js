import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import usePersistedState, { oneOf } from '../lib/usePersistedState';
import useUserStore from '../store/userStore';
import useMarketStore from '../store/marketStore';
import usePolling from '../lib/usePolling';
import usePortfolio from '../lib/usePortfolio';
import useFutures from '../lib/useFutures';
import { buildChartLines, spotEntryFromTrades } from '../lib/chartLines';
import { API, authed, errText } from '../lib/api';
import { fmtPrice } from '../components/ui/fmt';
import { FUT, coin as baseOf } from '../components/liquidation/shared';
import useFuturesStore from '../store/futuresStore';
import useAlertStore from '../store/alertStore';
import useStrategyStore from '../store/strategyStore';
import useStrategyOverlay from '../lib/useStrategyOverlay';
import strategyTimeframe from '../lib/strategyTimeframe';
import AgentLauncher from '../components/ai/AgentLauncher';
import StrategyChip from '../components/ai/StrategyChip';
import SegTabs from '../components/ui/SegTabs';
import { buildSymbols } from '../components/trade/SymbolCombobox';
import SymbolHeader from '../components/trade/SymbolHeader';
import MarketChartPanel from '../components/trade/MarketChartPanel';
import OrderBookPanel from '../components/trade/OrderBookPanel';
import TradesTapePanel from '../components/trade/TradesTapePanel';
import OrderCard from '../components/trade/OrderCard';
import BottomStrip from '../components/trade/BottomStrip';
import MarketStatsPanel from '../components/trade/MarketStatsPanel';
import SymbolLiquidations from '../components/trade/SymbolLiquidations';

const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const SYMBOL_RE = /^[A-Z0-9]{2,20}$/;
const MOBILE_TABS = [{ id: 'order', label: 'Order' }, { id: 'book', label: 'Book' }, { id: 'trades', label: 'Trades' }];

// Below xl the page stacks and scrolls. At xl it fills the height under the header: the chart row and the
// Positions/History/AI strip share the left, the book and tape the middle, the order form and stats the right.
const Trade = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = useUserStore((s) => s.token);
  const prefSymbol = useUserStore((s) => s.user?.preferences?.defaultSymbol);
  const defaultTf = useUserStore((s) => s.user?.preferences?.defaultTimeframe) || '1m';
  const marketData = useMarketStore((s) => s.marketData);
  const account = usePortfolio(token);
  const futures = useFutures(token);

  const [message, setMessage] = useState({ type: '', text: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ordersKey, setOrdersKey] = useState(1); // bump to refetch open orders now
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelError, setCancelError] = useState('');
  const [mobileTab, setMobileTab] = usePersistedState('trade.mobileTab', 'order', { validate: oneOf('order', 'book', 'trades') });
  // ?alerts=1 forces the alerts view on first load only; afterwards the stored choice applies.
  const [storedView, setView] = usePersistedState('trade.chartView', 'chart', { validate: oneOf('chart', 'alerts') });
  const [forceAlerts, setForceAlerts] = useState(searchParams.get('alerts') === '1');
  const view = forceAlerts ? 'alerts' : storedView;
  const onView = (v) => { setForceAlerts(false); setView(v); };
  const [storedSymbol, setStoredSymbol] = usePersistedState('trade.symbol', null, { validate: (v) => SYMBOL_RE.test(v) });
  const unread = useAlertStore((s) => s.unread);

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

  // The futures symbol comes from the URL, else the last pick, else the user's default pair (Settings), else BTC; CoinGecko data is only decoration when it has the coin.
  const urlSymbol = searchParams.get('symbol')?.toUpperCase();
  const prefBase = prefSymbol?.replace(/USDT$/, '').toUpperCase();
  const symbol = [urlSymbol, storedSymbol, prefBase].find((s) => s && SYMBOL_RE.test(s)) || 'BTC';
  const futuresSymbol = `${symbol}USDT`;
  const cg = useMemo(() => availableCoins.find((c) => c.symbol === symbol), [availableCoins, symbol]);

  const openOrders = usePolling(token ? `${API}/api/orders` : null, 5000, ordersKey, token);
  const ov = usePolling(`${FUT}/overview`, 15000);
  const overview = useMemo(() => (Array.isArray(ov.data) ? ov.data : []), [ov.data]);
  const ovRow = useMemo(() => overview.find((r) => r.symbol === futuresSymbol) || null, [overview, futuresSymbol]);
  // base symbol -> futures last price, for position P&L (overview covers the top-40 perps only)
  const prices = useMemo(() => Object.fromEntries(overview.map((r) => [baseOf(r.symbol), r.lastPrice ?? r.markPrice])), [overview]);
  // Every tradable perp (~700) for the picker; the combobox caps what it renders at 50 per filter.
  const allSyms = usePolling(`${FUT}/symbols`, 300000);
  const symbols = useMemo(() => {
    return buildSymbols(allSyms.data, overview, availableCoins.map((c) => c.symbol), symbol);
  }, [allSyms.data, overview, availableCoins, symbol]);
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

  const overlay = useStrategyOverlay({ kind: 'perp', symbol: futuresSymbol, interval, candles });
  // 'Show on chart' from the dock: move the chart to the strategy's timeframe once, when it is set.
  const active = useStrategyStore((s) => s.active);
  useEffect(() => {
    const tf = strategyTimeframe(active, useStrategyStore.getState().applied, { symbol: futuresSymbol, tfs: TFS, current: useFuturesStore.getState().interval });
    if (tf) setTimeframe(tf);
    if (active && active.kind === 'perp' && active.symbol === futuresSymbol) useStrategyStore.getState().markApplied(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the dock sets a new strategy, not when the user changes symbol
  }, [active, setTimeframe]);

  const ready = storeSymbol === futuresSymbol;
  const reloadSeq = useFuturesStore((s) => s.reloadSeq);
const klineSource = useFuturesStore((s) => s.klineSource);
  // Futures last price (last candle close, else mark); never the CoinGecko spot price.
  const lastPrice = ready ? (candles.length ? candles[candles.length - 1].close : mark?.markPrice ?? null) : null;

  const spotOrders = useMemo(() => (Array.isArray(openOrders.data?.orders) ? openOrders.data.orders : []), [openOrders.data]);
  const lines = useMemo(
    () => buildChartLines({
      symbol: futuresSymbol,
      positions: futures.positions,
      futuresOrders: futures.orders,
      spotOrders,
      spotEntry: spotEntryFromTrades(account.trades, symbol),
      mark: lastPrice,
    }),
    [futuresSymbol, symbol, futures.positions, futures.orders, spotOrders, account.trades, lastPrice]
  );

  // Market: the server fills at its own mark price, so only {cryptoSymbol, type, amount} is sent. Limit adds
  // orderType + limitPrice and the server only reserves funds. The user always comes from the token.
  const handleSubmit = async ({ type, amount, orderType = 'market', limitPrice }) => {
    setMessage({ type: '', text: '' });
    if (!token) {
      setMessage({ type: 'error', text: 'Please login to trade.' });
      navigate('/login');
      return false;
    }

    setIsSubmitting(true);
    try {
      const limit = orderType === 'limit';
      const body = { cryptoSymbol: symbol, type, amount: Number(amount), ...(limit ? { orderType, limitPrice: Number(limitPrice) } : {}) };
      const { data } = await axios.post(`${API}/api/trades`, body, authed(token));
      if (limit) {
        const o = data.order;
        setMessage({
          type: 'success',
          text: `Limit ${type} placed: ${o.amount} ${o.symbol} @ ${fmtPrice(o.limitPrice)}. Reserved ${type === 'buy' ? `$${fmtPrice(o.reserved)}` : `${o.reserved} ${o.symbol}`}. Balance $${fmtPrice(data.balance)}.`,
        });
        setOrdersKey((k) => k + 1);
      } else {
        const f = data.fill;
        setMessage({
          type: 'success',
          text: `${type === 'buy' ? 'Bought' : 'Sold'} ${f.amount} ${f.symbol} @ ${fmtPrice(f.price)}. Fee $${fmtPrice(f.fee)}. Balance $${fmtPrice(data.balance)}.`,
        });
      }
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

  const handleCancel = async (id) => {
    setCancelError('');
    setCancellingId(id);
    try {
      await axios.delete(`${API}/api/orders/${id}`, authed(token));
    } catch (error) {
      console.error(error.message);
      setCancelError(error.response?.status === 429 ? 'Too many requests, slow down.' : error.response?.data?.message || 'Unable to cancel the order.');
    } finally {
      setCancellingId(null);
      setOrdersKey((k) => k + 1); // also corrects the list after a 409 (already filled)
      account.reload();
    }
  };

  const onSymbol = (s) => {
    setStoredSymbol(s);
    setSearchParams({ symbol: s, ...(view === 'alerts' ? { alerts: '1' } : {}) }, { replace: true });
  };

  const show = (tab) => (mobileTab === tab ? '' : 'hidden xl:flex');

  return (
    <div className="flex flex-col gap-3 xl:h-full">
      <SymbolHeader
        symbols={symbols}
        symbol={symbol}
        overview={overview}
        change={cg?.change}
        futuresSymbol={futuresSymbol}
        ready={ready}
        candles={candles}
        mark={mark}
        onSymbol={onSymbol}
      />

      <div className="grid gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_280px_300px] xl:grid-rows-[minmax(0,1fr)_minmax(140px,32%)]">
        <MarketChartPanel
          className="h-[420px] xl:col-start-1 xl:row-start-1 xl:h-auto xl:min-h-0"
          ticker={symbol}
          view={view}
          onView={onView}
          alertsSymbol={futuresSymbol}
          unread={unread}
          interval={interval}
          onInterval={setTimeframe}
          candles={candles}
          klineSource={klineSource}
          lines={lines}
          overlays={overlay.overlays}
          markers={overlay.markers}
          strategyChip={<StrategyChip chip={overlay.chip} />}
          headerExtra={<AgentLauncher kind="perp" symbol={futuresSymbol} page="trade" interval={interval} />}
          reloadSeq={reloadSeq}
          error={futuresError}
          ready={ready}
          onRetry={() => subscribe(futuresSymbol, interval)}
        />

        <SegTabs tabs={MOBILE_TABS} active={mobileTab} onChange={setMobileTab} label="Trading panels" className="xl:hidden" />

        <div className={`${mobileTab === 'order' ? 'hidden xl:flex' : 'flex'} min-h-0 flex-col gap-3 xl:col-start-2 xl:row-span-2 xl:row-start-1`}>
          <OrderBookPanel
            className={`${show('book')} xl:min-h-0 xl:flex-[3_1_0]`}
            book={book}
            loading={ready && !book && !futuresError}
          />
          <TradesTapePanel className={`${show('trades')} flex-1 xl:min-h-0 xl:flex-[2_1_0]`} trades={trades} loading={ready && !futuresError && trades.length === 0} />
        </div>

        <div className={`${mobileTab === 'order' ? 'flex' : 'hidden xl:flex'} min-h-0 min-w-0 flex-col gap-3 xl:col-start-3 xl:row-span-2 xl:row-start-1`}>
          <OrderCard
            key={symbol}
            className="xl:max-h-[75%] xl:min-h-[200px] xl:flex-[0_1_auto] xl:overflow-y-auto"
            spot={{
              coin: { symbol, price: lastPrice },
              symbols,
              overview,
              onSymbol,
              balance: account.balance,
              balanceLoading: account.loading,
              onSubmit: handleSubmit,
              message,
              isSubmitting,
            }}
            futures={{ coin: { symbol, price: lastPrice }, symbols, overview, onSymbol, token, futures, account }}
          />
          <MarketStatsPanel className="xl:min-h-0 xl:flex-[0_1_auto] xl:overflow-y-auto" row={ovRow} mark={ready ? mark : null} />
          <SymbolLiquidations className="min-h-[160px] flex-1 xl:min-h-[110px] xl:[@media(max-height:760px)]:hidden" symbol={futuresSymbol} />
        </div>

        <BottomStrip
          className="xl:col-start-1 xl:row-start-2"
          symbol={futuresSymbol}
          account={account}
          futures={futures}
          prices={prices}
          orders={{
            rows: Array.isArray(openOrders.data?.orders) ? openOrders.data.orders : [],
            loading: openOrders.loading,
            fetching: !!openOrders.fetching,
            error: cancelError || (openOrders.error ? errText(openOrders.error) : ''),
            cancellingId,
            onCancel: handleCancel,
          }}
        />
      </div>
    </div>
  );
};

export default Trade;
