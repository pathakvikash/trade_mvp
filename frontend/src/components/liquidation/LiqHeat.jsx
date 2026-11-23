import React, { useState } from 'react';
import usePersistedState from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import LiqHeatmap, { RANGES } from './LiqHeatmap';
import { KeyLevels, Overview } from './LiqSide';
import { FUT } from './shared';

// First section of the page: predicted heatmap + side panels (stacked below 1280px).
const LiqHeat = ({ symbol }) => {
  const [range, setRange] = usePersistedState('liquidation.heatRange', '24h', { validate: (v) => RANGES.some((r) => r.id === v) });
  const [tick, setTick] = useState(0); // bumping it refetches without clearing the current picture
  const [highlight, setHighlight] = useState(null);
  const { data, error, loading, fetching, source } = usePolling(`${FUT}/liqheat/${symbol}?range=${range}`, 60000, tick);
  const ok = data && data.cols > 0;
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <LiqHeatmap symbol={symbol} range={range} onRange={setRange} data={data} source={source} loading={loading} error={error} refreshing={!!fetching} onRefresh={() => setTick((t) => t + 1)} highlight={highlight} />
      {ok && (
        <div className="relative"> {/* on desktop the panels take the heatmap's height and scroll inside it */}
          <div className="space-y-3 xl:absolute xl:inset-0 xl:overflow-y-auto xl:overscroll-contain">
            <KeyLevels data={data} onHighlight={setHighlight} />
            <Overview data={data} symbol={symbol} />
          </div>
        </div>
      )}
    </div>
  );
};

export default LiqHeat;
