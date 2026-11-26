import React, { useMemo, useRef, useState } from 'react';
import usePersistedState, { oneOf } from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import useMaximize from '../ui/useMaximize';
import { MaximizeBackdrop } from '../ui/MaximizeButton';
import { LoadingBlock } from '../ui/Skeleton';
import ObhCanvas from './ObhCanvas';
import ObhControls from './ObhControls';
import ObhExplainer from './ObhExplainer';
import ObhHeader from './ObhHeader';
import ObhSidePanel from './ObhSidePanel';
import ObhStats from './ObhStats';
import useZoomPan from './useZoomPan';
import { PALETTES } from './heat';
import { BANDS, DEFAULT_LAYERS, INTERVALS, UNITS, scaleCells, validLayers } from './obh';
import { KLINES, ORDERFLOW, THIN_TEXT, collectingText, flowNotice } from './orderflow';
import { Notice, Panel, StaleNote, coin, fmtMarketPrice } from './shared';

// Order book heatmap: resting order size by price over time from depth snapshots this server has collected since it started
// for the coin. Container: data, persisted choices and layout; the parts live in the Obh* files.
const OrderBookHeatmap = ({ symbol }) => {
  const [palette, setPalette] = usePersistedState('obh.palette', 'viridis', { validate: (v) => PALETTES.some((p) => p.id === v) });
  const [unit, setUnit] = usePersistedState('obh.unit', 'usd', { validate: oneOf(...UNITS.map((u) => u.id)) });
  const [band, setBand] = usePersistedState('obh.band', 1, { validate: (v) => BANDS.includes(v) });
  const [layers, setLayers] = usePersistedState('obh.layers', DEFAULT_LAYERS, { validate: validLayers });
  const [interval, setInterval_] = usePersistedState('obh.interval', '1m', { validate: oneOf(...INTERVALS.map((i) => i.id)) });
  const [grid, setGrid] = useState(1);
  const [sub, setSub] = useState('none');
  const [range, setRange] = useState([0, 100]);
  const [refreshKey, setRefreshKey] = useState(0);
  const m = useMaximize();
  const plotRef = useRef(null);
  const shot = useRef(null);

  const { data, error, loading, fetching } = usePolling(`${ORDERFLOW}/heatmap/${symbol}?grid=${grid}&band=${band}`, 5000, refreshKey || undefined, undefined, true);
  const ok = !!data && data.symbol === symbol && data.cols > 0 && !!data.book;
  // candles come from the existing futures klines route (cached server side), not from the collector
  const kl = usePolling(ok && layers.candles ? `${KLINES}/${symbol}?interval=${interval}&limit=150` : null, 15000);
  const candles = Array.isArray(kl.data) ? kl.data : null;
  const ivMs = INTERVALS.find((i) => i.id === interval).ms;
  const zoom = useZoomPan(plotRef, { axes: 'xy', resetKey: `${symbol}|${grid}`, enabled: ok });
  const scaled = useMemo(() => (ok ? scaleCells(data, unit) : null), [ok, data, unit]);
  const notice = flowNotice(error, data);
  const collecting = data && !ok;
  const height = m.max ? 560 : 380;

  const onShot = () => shot.current?.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${coin(symbol)}-orderbook-heatmap-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
  const controls = ok && {
    palette, onPalette: setPalette, unit, onUnit: setUnit, range, onRange: setRange, max: scaled.max,
    grid, onGrid: setGrid, baseStep: data.priceStep / data.grid, band, onBand: setBand, sub, onSub: setSub, layers, onLayers: setLayers,
    zoom, onShot, onRefresh: () => setRefreshKey((k) => k + 1), refreshing: !!fetching, isMax: m.max, onToggleMax: m.toggle,
  };

  return (
    <>
      <MaximizeBackdrop max={m.max} onClose={m.exit} />
      <Panel
        id="order-book-heatmap"
        title={`${coin(symbol)} order book heatmap`}
        className={m.panelClass}
        bodyClassName={`min-h-0 p-3 ${m.max ? 'overflow-y-auto' : ''}`}
        {...m.panelProps}
        right={<ObhHeader symbol={symbol} source={data?.source} interval={interval} onInterval={setInterval_} palette={palette} onPalette={setPalette} data={data?.symbol === symbol ? data : null} error={error} />}
      >
        <p className="mb-2 text-xs text-amber-400">Built from depth snapshots since the collector started; not historical. Resting orders can be cancelled (spoofing), so size on the book is not size that will trade.</p>
        {ok && data.stale && <StaleNote at={data.generatedAt} />}
        {ok && !data.stale && error && <StaleNote />}
        {data?.source && data.source !== 'binance-futures' && <p className="mb-2 text-xs text-amber-400">Order book from {data.source} perpetuals (Binance futures unavailable from this server); sizes differ from Binance.</p>}
        {collecting ? (
          <Notice><span role="status">{data.status === 'thin' ? THIN_TEXT : data.status === 'unavailable' ? 'Order book data is unavailable from this server right now.' : `${collectingText(data.collectedMs)}. The first picture appears after a few snapshots.`}</span></Notice>
        ) : !ok ? (
          loading ? <LoadingBlock height={height} /> : <Notice tone={error ? 'error' : 'muted'}>{notice || 'No order book data yet.'}</Notice>
        ) : (
          <>
            <ObhStats data={data} symbol={symbol} />
            <ObhControls c={controls} />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_21rem]">
              <div className="min-w-0">
                <ObhCanvas
                  ref={shot} symbol={symbol} d={data} cells={scaled.cells} max={scaled.max} palette={palette} range={range} layers={layers}
                  candles={candles} ivMs={ivMs} sub={sub} unit={unit} interval={interval} zoom={zoom} plotRef={plotRef} height={height}
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  {collectingText(data.collectedMs)} ({data.samples} snapshots, one every {data.sampleMs / 1000} s, at most {Math.round(data.retainMs / 3600e3)} h kept). Price buckets are {fmtMarketPrice(data.priceStep)} wide and cover only the levels one snapshot returns, so a wide move leaves the picture. Empty means no resting size seen. Candles come from the exchange; wall tags and bubbles are drawn from what the snapshots caught.
                </p>
              </div>
              <ObhSidePanel d={data} unit={unit} />
            </div>
          </>
        )}
        <ObhExplainer />
      </Panel>
    </>
  );
};

export default OrderBookHeatmap;
