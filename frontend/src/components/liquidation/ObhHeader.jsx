import React from 'react';
import ObhMenu, { field } from './ObhMenu';
import { PALETTES, rampCss } from './heat';
import { INTERVALS, liveStatus } from './obh';
import { coin } from './shared';

// Pill + interval + status + Colours + info. The pair is chosen by the page's picker above, so the pill only states what is shown.
const ObhHeader = ({ symbol, source, interval, onInterval, palette, onPalette, data, error }) => {
  const st = liveStatus(data, error);
  const venue = source === 'bybit' ? 'Bybit' : 'Binance';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex min-h-[32px] items-center rounded-full border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200" title="Change the pair with the picker at the top of the page">{symbol} Perp {'·'} {venue}</span>
      <label className="sr-only" htmlFor="obh-interval">Candle interval</label>
      <select id="obh-interval" value={interval} onChange={(e) => onInterval(e.target.value)} className={field}>
        {INTERVALS.map((i) => <option key={i.id} value={i.id}>{i.id} candles</option>)}
      </select>
      <span className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs ${st.cls}`}>
        {st.dot && <i aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />}{st.text}
      </span>
      <ObhMenu label="Colours" buttonLabel="Colours">
        <div role="radiogroup" aria-label="Colour palette" className="space-y-1">
          {PALETTES.map((p) => (
            <label key={p.id} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded px-1 hover:bg-slate-800 sm:min-h-0 sm:py-1">
              <input type="radio" name="obh-palette" checked={palette === p.id} onChange={() => onPalette(p.id)} className="accent-cyan-400" />
              <i aria-hidden="true" className="inline-block h-2 w-10 rounded-sm" style={{ background: rampCss(p.id) }} />{p.label}
            </label>
          ))}
        </div>
      </ObhMenu>
      <ObhMenu label="i" buttonLabel={`About the ${coin(symbol)} order book heatmap`} width="w-72" className={`${field} min-w-[44px] font-serif italic sm:min-w-0`}>
        <p>Brighter cells = more resting size at that price. Candles, a grey price line and wall tags sit on top.</p>
        <p className="mt-1 text-slate-400">Built from depth snapshots taken since the collector started for this coin, not history. Resting orders can be cancelled, so size is not size that will trade.</p>
      </ObhMenu>
    </div>
  );
};

export default ObhHeader;
