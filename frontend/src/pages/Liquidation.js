import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import usePersistedState from '../lib/usePersistedState';
import usePolling from '../lib/usePolling';
import LiquidationHeatmap from '../components/LiquidationHeatmap';
import Summary from '../components/liquidation/Summary';
import CoinTreemap from '../components/liquidation/CoinTreemap';
import LiqHeat from '../components/liquidation/LiqHeat';
import LiqMap from '../components/liquidation/LiqMap';
import LiveFeed from '../components/liquidation/LiveFeed';
import CoinDetail from '../components/liquidation/CoinDrawer';
import AgentLauncher from '../components/ai/AgentLauncher';
import PairPicker from '../components/ui/PairPicker';
import RelatedTools from '../components/liquidation/RelatedTools';
import OtherCoinsGrid from '../components/liquidation/OtherCoinsGrid';
import LiqFaq from '../components/liquidation/LiqFaq';
import { FUT } from '../components/liquidation/shared';

const SYMBOL_RE = /^[A-Z0-9]{2,20}USDT$/;

const Liquidation = () => {
  const { data, error } = usePolling(`${FUT}/liquidations`, 5000);
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = usePersistedState('liquidation.symbol', 'BTCUSDT', { validate: (v) => SYMBOL_RE.test(v) });
  const raw = (params.get('symbol') || '').toUpperCase();
  const symbol = SYMBOL_RE.test(raw) ? raw : saved; // ?symbol= wins over the remembered pick
  const setSymbol = (s) => { setSaved(s); setParams({ symbol: s }); };
  // other coins for the grid: the 20 most traded perps (same overview the pair picker uses), minus the current one
  const ov = usePolling(`${FUT}/overview`, 60000);
  const others = useMemo(() => (Array.isArray(ov.data) ? ov.data : [])
    .filter((r) => r.symbol !== symbol && SYMBOL_RE.test(r.symbol))
    .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0))
    .slice(0, 20)
    .map((r) => r.symbol), [ov.data, symbol]);
  const pickOther = (s) => { setSymbol(s); document.getElementById('liq-heatmap')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); };
  const [detail, setDetail] = useState(false); // drawer open state is per visit, not persisted
  const closeDetail = useCallback(() => setDetail(false), []);
  const pickCoin = (s) => { setSymbol(s); setDetail(true); };

  return (
    <div className="space-y-3 pb-16"> {/* bottom room for the floating Legend button */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-200">{symbol} Liquidation Heatmap</h1>
          <p className="text-xs text-slate-400">
            Binance USD-M perpetuals. Realized liquidation data is a sample: Binance publishes at most one liquidation per symbol per second, so real totals are higher.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AgentLauncher kind="perp" symbol={symbol} page="liquidation" />
          <PairPicker value={symbol} onChange={setSymbol} />
        </div>
      </div>
      <LiqHeat symbol={symbol} />
      <Summary data={data} error={error} />
      <CoinTreemap bySymbol={data?.bySymbol} error={error} selected={symbol} onSelect={pickCoin} onHeatmap={setSymbol} />
      <LiquidationHeatmap symbol={symbol} />
      <LiqMap symbol={symbol} />
      <LiveFeed recent={data?.recent} error={error} />
      <RelatedTools />
      <section aria-labelledby="other-coins-h" className="space-y-2">
        <h2 id="other-coins-h" className="text-sm font-semibold text-slate-200">Liquidation heatmaps of other coins</h2>
        <OtherCoinsGrid symbols={others} onPick={pickOther} />
      </section>
      <LiqFaq />
      {detail && <CoinDetail symbol={symbol} bySymbol={data?.bySymbol} onClose={closeDetail} />}
    </div>
  );
};

export default Liquidation;
