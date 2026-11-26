# Coinglass UX notes (competitor study, 2026-11-26)

Patterns observed on Coinglass's public pages, written down so we can build equivalent UX with our own code, wording and colours. Do not copy their text, assets or branding. Our data limits still apply (estimates, sampled feed, depth only since the collector started).

## Order Book Heatmap (/LiquidityHeatmap/BTC) — redesign in progress
- Header: title, symbol/exchange pill, candle-interval dropdown, green Live pill, Colours button, info button.
- 6 stat cards: last price (bid/ask), bid depth 1% below, ask depth 1% above, imbalance (+ delta vs 5 min ago), largest bid wall and largest ask wall (price, size, distance %, how long it has stood).
- Control bar: colouring, unit (value/size), colour-range slider, screenshot/refresh/fullscreen; price grid, depth band, sub panes, layers.
- Canvas: heat + candles on top, wall tags pinned right ("Ask wall 6.11M"), last-price tag, crosshair readout, "Loading history n/4" chip.
- Side panel tabs: Book (ladder with cumulative depth bars), Walls, Wall events (pulled / filled).
- Explainer with worked example and legend (grey = price, green = taker buys, red = taker sells; pulled vs filled vs holds).

## Liquidation Heatmap (/LiquidationHeatMap/BTC)
- Model 1/2/3 switch, Pair/Coin switch, symbol+exchange pill; Range, Layout, Pan/Measure, status pill, refresh, Screenshot; Lens, Colours, Intensity range; Display menu; right column "Key liquidation levels" + "Market overview". (We already mirror most of this.)

## Liquidation Map (/pro/futures/LiquidationMap)
- Price-bucket bars stacked by leverage tier (10x/25x/50x/100x colours), cumulative long (red) and short (green) lines on a second axis, dashed current-price marker with label, range slider under the chart, exchange/pair and 1-day selectors, Long/Short/Trade buttons. A second block shows the same map aggregated across exchanges.

## Liquidation Max Pain (/liquidation-maxpain)
- Multi-coin view: window (24H), symbol filter, Top 50, search; 4 summary cards (market pull, critical within 1%, strongest confluence, two-way squeeze).
- "Pain force field": bubbles (size = estimated liquidations) placed by distance from price, long pain on the left, short pain on the right, +-1% critical band; toggles for confluence and critical-only; Distance % / Volatility sigma and Field / Quadrant views.
- Detail panel for the selected coin: mini price chart with the max-pain levels per window, short pain above / long pain below cards (price, distance, est. liquidations, touch chance, confluence), pull bar.

## CVD (/cvd/BTC)
- Header with symbol, interval chips (1m...1W), market selector (8/21 markets), Loading/Live pill, FAQ.
- 6 stat cards: last price, futures CVD, spot CVD, taker buy %, spot vs futures, latest divergence.
- Chart controls: Show (futures vs spot / combined / futures / spot / by exchange), anchor (start of view), scale (normalized / absolute), markers (divergence, tooltip), panes (delta, buy/sell ratio, volume), Reset view.
- Side panel: Live trades (threshold chips 10K/50K/100K/500K/1M, taker flow last 60 s) and Divergences tabs. The Live trades list is the same idea as our Large Orders.

## Large / Whale orders
- Order Flow menu also lists Whale Orders and Orderbook Pressure / Liquidity Delta (not studied in detail).
