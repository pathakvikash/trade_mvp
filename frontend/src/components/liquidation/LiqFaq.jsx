import React from 'react';

// Honest FAQ for the liquidation page. Every answer describes an estimate or a sample as one (CLAUDE.md rule 8). No investment advice.
export const LIQ_FAQ = [
  ['What does the heatmap show?', 'Estimated price levels where leveraged positions may be liquidated, and how that estimate changes over time. Brighter cells mean more estimated liquidation value in that price and time bucket. It is a model, not a list of real positions.'],
  ['How are the levels estimated?', 'Each rise in open interest is treated as new positions. Those positions are split 50/50 between longs and shorts, spread over a leverage mix from 5x to 125x, and entered at candle prices. Each liquidation price uses a 0.4% maintenance margin. Every input is public market data.'],
  ['Why is this an estimate and not exchange data?', 'Exchanges do not publish which leverage each trader uses or where their positions would be closed. Open interest shows how total position size changes, not who holds it, in which direction, or at what leverage. The assumptions above are our best model of that.'],
  ['Why is the liquidation feed sampled?', 'Binance publishes at most one liquidation event per symbol per second, so the feed misses some liquidations. Real totals are higher than the ones shown. Use the feed to see direction and rough scale, not exact totals.'],
  ['What do the colours and intensity mean?', 'Colour and intensity change only how the estimates are displayed. They never change the numbers behind them. The legend on the page shows the scale that the colours map to.'],
  ['Which data source is used, and what happens when it fails?', 'Binance USD-M futures is the first source. If Binance blocks requests from our server, we use Bybit, Bitget, Gate or MEXC for the data they can provide. The heatmap and map are rebuilt from Bybit or Gate candles and open interest if the symbol is listed there, otherwise they are unavailable. The source note on the page names the exchange whose numbers you are seeing, and numbers differ between exchanges. If no source can answer, the page says the data is unavailable. If a refresh fails after numbers have loaded, the last good numbers stay on screen with a note that the refresh failed and the time they are from, until a refresh succeeds.'],
  ['How often does the data refresh?', 'The live liquidation feed and the rekt summary poll about every 5 seconds. The heatmap, the map and the coin overview refresh about every 60 seconds, and you can refresh the heatmap manually. Polling pauses while the browser tab is hidden. The estimates are computed on our server, so they can lag the live market by a few seconds.'],
  ['What does "partial history" mean?', 'For a newly listed symbol the data provider has fewer candles than the range you chose. The estimate uses the candles that exist and is labelled partial. This is not an error, and it is not a sign that the coin is unusual.'],
];

const LiqFaq = () => (
  <section aria-labelledby="liq-faq-h" className="space-y-2">
    <h2 id="liq-faq-h" className="text-sm font-semibold text-slate-200">About these numbers</h2>
    <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/60">
      {LIQ_FAQ.map(([q, a]) => (
        <details key={q} className="group px-4">
          <summary className="focus-ring flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm text-slate-100 [&::-webkit-details-marker]:hidden">
            {q}
            <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-180">v</span>
          </summary>
          <p className="pb-3 text-xs leading-relaxed text-slate-400">{a}</p>
        </details>
      ))}
    </div>
  </section>
);

export default LiqFaq;
