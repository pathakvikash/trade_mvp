import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import usePersistedState from '../lib/usePersistedState';
import useUserStore from '../store/userStore';
import useFuturesStore from '../store/futuresStore';
import usePolling from '../lib/usePolling';
import { FUT, coin } from '../components/liquidation/shared';
import Panel from '../components/ui/Panel';
import { fmtPct, fmtUsd } from '../components/ui/fmt';
import SymbolHeader from '../components/trade/SymbolHeader';
import KeyStats from '../components/trade/KeyStats';
import SymbolLiquidations from '../components/trade/SymbolLiquidations';
import MarketList from '../components/market/MarketList';
import MarketChart from '../components/market/MarketChart';

const SYMBOL_RE = /^[A-Z0-9]{2,20}USDT$/;
const DEFAULT_SYMBOL = 'BTCUSDT';
const NO_ROWS = [];
const normalise = (s) => {
  const v = (s || '').toUpperCase();
  return SYMBOL_RE.test(v) ? v : null;
};

// Markets: live futures list (left) and the selected symbol's chart, stats, liquidations and links (right).
// At xl the page fills the height under the header: the list runs full height, the right column splits into
// chart and a row of three panels. Data: Binance futures overview (REST, polled) for the list and stats;
// futuresStore (socket + klines) for the chart, as on the Trade page.
const Market = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefSymbol = useUserStore((s) => s.user?.preferences?.defaultSymbol);
  const defaultTf = useUserStore((s) => s.user?.preferences?.defaultTimeframe) || '1m';
  const [retryKey, setRetryKey] = useState(0);
  const ov = usePolling(`${FUT}/overview`, 15000, retryKey);
  const rows = useMemo(() => (Array.isArray(ov.data) ? ov.data : null), [ov.data]);

  // Selection lives in ?symbol=BTCUSDT; falls back to the remembered pick, then the user's default pair, then BTCUSDT.
  const [saved, setSaved] = usePersistedState('market.symbol', null, { validate: (v) => v === null || SYMBOL_RE.test(v) });
  const symbol = normalise(searchParams.get('symbol')) || saved || normalise(prefSymbol) || DEFAULT_SYMBOL;
  const base = coin(symbol);
  const current = useMemo(() => rows?.find((r) => r.symbol === symbol) || null, [rows, symbol]);
  const symbols = useMemo(() => {
    const list = (rows || []).map((r) => coin(r.symbol));
    return list.includes(base) ? list : [base, ...list];
  }, [rows, base]);

  const candles = useFuturesStore((s) => s.candles);
  const mark = useFuturesStore((s) => s.mark);
  const interval = useFuturesStore((s) => s.interval);
  const futuresError = useFuturesStore((s) => s.error);
  const storeSymbol = useFuturesStore((s) => s.symbol);
  const reloadSeq = useFuturesStore((s) => s.reloadSeq);
  const subscribe = useFuturesStore((s) => s.subscribe);
  const unsubscribe = useFuturesStore((s) => s.unsubscribe);
  const setTimeframe = useFuturesStore((s) => s.setTimeframe);
  const ready = storeSymbol === symbol;

  useEffect(() => {
    subscribe(symbol, defaultTf);
  }, [symbol, subscribe, defaultTf]);
  useEffect(() => unsubscribe, [unsubscribe]);

  const select = (s) => { setSaved(s); setSearchParams({ symbol: s }, { replace: true }); };

  const rate = current?.fundingRate;
  const fundingHours = current?.fundingIntervalHours;
  const apr = rate == null ? null : rate * (24 / (fundingHours || 8)) * 365 * 100;
  const markPx = (ready && mark?.markPrice) || current?.markPrice;
  const indexPx = (ready && mark?.indexPrice) || current?.indexPrice;
  const basis = markPx && indexPx ? (markPx / indexPx - 1) * 100 : null;

  return (
    <div className="flex flex-col gap-3 xl:h-full">
      <div className="xl:shrink-0">
        <h1 className="text-lg font-semibold text-slate-200">Markets</h1>
        <p className="text-xs text-slate-400">Binance USD-M perpetuals: live prices, candles and funding.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start xl:min-h-0 xl:flex-1 xl:grid-rows-[minmax(0,1fr)] xl:items-stretch">
        <MarketList
          className="xl:min-h-0"
          rows={rows}
          error={ov.error}
          onRetry={() => setRetryKey((k) => k + 1)}
          selected={symbol}
          onSelect={select}
        />

        <div className="flex min-w-0 flex-col gap-3 xl:min-h-0">
          <SymbolHeader
            symbols={symbols}
            symbol={base}
            futuresSymbol={symbol}
            overview={rows || NO_ROWS}
            ready={ready}
            candles={candles}
            mark={mark}
            onSymbol={(b) => select(`${b}USDT`)}
          />

          <MarketChart
            className="h-[420px] max-xl:[@media(min-height:1100px)]:h-[620px] xl:h-auto xl:min-h-0 xl:flex-[3_1_0]"
            ticker={symbol}
            interval={interval}
            onInterval={setTimeframe}
            candles={candles}
            reloadSeq={reloadSeq}
            error={futuresError}
            ready={ready}
            onRetry={() => subscribe(symbol, interval)}
          />

          <div className="grid gap-3 md:grid-cols-2 xl:min-h-[240px] xl:flex-[2_1_0] xl:grid-cols-3">
            <Panel title={`${base} key stats`} className="min-h-0">
              <KeyStats
                items={[
                  { label: 'Open interest', value: fmtUsd(current?.openInterestUsd) },
                  { label: 'Funding rate', value: rate == null ? '--' : `${(rate * 100).toFixed(4)}%` },
                  { label: 'Funding APR', value: fmtPct(apr, 1) },
                  { label: 'Funding interval', value: fundingHours ? `${fundingHours}h` : '--' },
                  { label: 'Mark vs index', value: fmtPct(basis, 3) },
                  { label: '24h volume', value: fmtUsd(current?.quoteVolume) },
                ]}
              />
            </Panel>

            <SymbolLiquidations symbol={symbol} className="min-h-[240px] xl:min-h-0" />

            <Panel title="Go to" className="min-h-0">
              <ul className="space-y-3 text-xs">
                <li>
                  <Link to={`/trade?symbol=${base}`} className="focus-ring block rounded-md bg-cyan-400 px-3 py-1.5 text-center font-semibold text-slate-950 hover:bg-cyan-300">Trade</Link>
                  <p className="mt-1 text-slate-500">Place a paper market order on {base}.</p>
                </li>
                <li>
                  <Link to={`/trade?symbol=${symbol}&alerts=1`} className="focus-ring block rounded-md border border-slate-700 px-3 py-1.5 text-center text-slate-200 hover:bg-slate-800">Set alert</Link>
                  <p className="mt-1 text-slate-500">Get notified when price, funding or liquidations cross a level.</p>
                </li>
                <li>
                  <Link to={`/liquidation?symbol=${symbol}`} className="focus-ring block rounded-md border border-slate-700 px-3 py-1.5 text-center text-slate-200 hover:bg-slate-800">Liquidations</Link>
                  <p className="mt-1 text-slate-500">Estimated liquidation map and sampled history.</p>
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Market;
