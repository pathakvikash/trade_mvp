import React, { useState } from 'react';
import SegTabs from '../ui/SegTabs';
import usePersistedState from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import LiqHeatmap, { RANGES } from '../liquidation/LiqHeatmap';
import { FUT } from '../liquidation/shared';

export const CHART_VIEWS = [
  { id: 'candles', label: 'Chart', title: 'Price chart' },
  { id: 'heatmap', label: 'Heatmap', title: 'Estimated liquidation heatmap (from open-interest changes)' },
];

// Remembered Candles | Heatmap choice, shared by the Trade and Market chart panels. `available` = the symbol has a futures
// heatmap; when it does not, the tab is hidden and the candles show (the stored choice is kept for the next symbol).
export function useChartView(available) {
  const [stored, setView] = usePersistedState('chart.view', 'candles', { validate: (v) => CHART_VIEWS.some((t) => t.id === v) });
  return { view: available ? stored : 'candles', setView };
}

export const ChartViewTabs = ({ view, onView }) => (
  <SegTabs tabs={CHART_VIEWS} active={view} onChange={onView} label="Chart view" className="[&_button]:min-h-[44px] sm:[&_button]:min-h-0" />
);

// The Liquidation page's heatmap component for one BTCUSDT-style symbol, embedded in a chart panel. Own range choice
// (same options and default as the page); lens, colours, intensity and display come from the shared persisted heat view.
const ChartHeatmap = ({ symbol }) => {
  const [range, setRange] = usePersistedState('chart.heatRange', '24h', { validate: (v) => RANGES.some((r) => r.id === v) });
  const [tick, setTick] = useState(0);
  const { data, error, loading, fetching, source } = usePolling(`${FUT}/liqheat/${symbol}?range=${range}`, 60000, tick);
  return (
    <LiqHeatmap embedded symbol={symbol} range={range} onRange={setRange} data={data} source={source} loading={loading} error={error} refreshing={!!fetching} onRefresh={() => setTick((t) => t + 1)} />
  );
};

export default ChartHeatmap;
