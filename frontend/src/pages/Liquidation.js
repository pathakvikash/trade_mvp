import React from 'react';
import { useSearchParams } from 'react-router-dom';
import usePolling from '../lib/usePolling';
import LiquidationHeatmap from '../components/LiquidationHeatmap';
import Summary from '../components/liquidation/Summary';
import CoinTreemap from '../components/liquidation/CoinTreemap';
import LiqHeat from '../components/liquidation/LiqHeat';
import LiqMap from '../components/liquidation/LiqMap';
import LiveFeed from '../components/liquidation/LiveFeed';
import PairPicker from '../components/ui/PairPicker';
import { FUT } from '../components/liquidation/shared';

const SYMBOL_RE = /^[A-Z0-9]{2,20}USDT$/;

const Liquidation = () => {
  const { data, error } = usePolling(`${FUT}/liquidations`, 5000);
  const [params, setParams] = useSearchParams();
  const raw = (params.get('symbol') || '').toUpperCase();
  const symbol = SYMBOL_RE.test(raw) ? raw : 'BTCUSDT';
  const setSymbol = (s) => setParams({ symbol: s });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-200">{symbol} Liquidation Heatmap</h1>
          <p className="text-xs text-slate-400">
            Binance USD-M perpetuals. Realized liquidation data is a sample: Binance publishes at most one liquidation per symbol per second, so real totals are higher.
          </p>
        </div>
        <PairPicker value={symbol} onChange={setSymbol} />
      </div>
      <LiqHeat symbol={symbol} />
      <Summary data={data} error={error} />
      <CoinTreemap bySymbol={data?.bySymbol} selected={symbol} onSelect={setSymbol} />
      <LiquidationHeatmap symbol={symbol} />
      <LiqMap symbol={symbol} />
      <LiveFeed recent={data?.recent} error={error} />
    </div>
  );
};

export default Liquidation;
