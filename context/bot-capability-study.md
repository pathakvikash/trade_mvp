# Bot capability study: what DSL paper bots can and cannot do

Status: study, 2026-11-26. Skeptical by design: the plan (`bot-trading-plan.md` section 1) predicts about zero edge
before costs; this tries to falsify that with out-of-sample data. Paper-trading research, not advice.

Reproduce (from `backend/`): `node scripts/botlab/fetch.js <dir>` (needs `fapi.binance.com`), then
`node scripts/botlab/study.js <dir> ../context/bot-capability-results.json`, `node scripts/botlab/analyze.js ../context/bot-capability-results.json`,
`node scripts/botlab/goal.js <dir> ../context/bot-goal-baserates.json`. Study runtime about 1 minute.

## 1. Data

Binance USDS-M perpetual klines (the upstream `services/futuresRest` uses). The app route `/api/market/futures/klines`
caps at 1000 rows and has no `endTime`, so it cannot page back; the scripts page `fapi/v1/klines` directly.
Candles that were still forming were dropped.

| Symbol | 15m (1 y) | 1h (3 y) | 4h (6 y) |
|---|---|---|---|
| BTC, ETH, SOL, LINK | 35,039 bars, 2025-11-26..2026-11-26 | 26,279, 2023-11-27..2026-11-26 | 13,139, 2020-11-27..2026-11-26 |
| MANTRA (thin; perp listed 2026-03-04) | 25,652 | 6,413 | 1,603 (too short: most 4h cells under 30 trades) |

Out-of-sample (last 40%) starts: 15m 2026-07-03, 1h 2025-09-14, 4h 2024-07-03 (MANTRA 2026-08-11).
**The OOS windows are mostly a bear market.** Buy-and-hold over the OOS window: 1h BTC -48%, ETH -63%, SOL -71%,
LINK -62%, MANTRA -54%; 4h BTC +0.4%, ETH -49%, SOL -51%, LINK -36%; 15m BTC -2%, ETH -2%, SOL -13%, LINK +18%.
Anything that was flat or short most of the time "beat buy-and-hold" here; that is regime, not skill.

## 2. Method

- **Same code as the app.** `parseSpec` validates every config (all 11,880 are valid DSL v1 specs);
  `indicators.js` and `backtest.simulate`/`stats` run unchanged. `evaluate()` caps at 1000 candles, so the study
  copies its 30-line signal interpreter verbatim and asserts parity with `evaluate()` on a 1000-candle BTC 1h
  window (14 trades, +2.3212%, identical).
- **Costs (app defaults):** fee 0.05% of notional per side (`TAKER_FEE_BPS = 5`), slippage 0.02% per fill, so
  0.14% of notional per round trip. Fill at next bar open; stop wins a same-bar stop/target tie; gap-through stops
  fill at the open. Funding is NOT charged (as in the app); spread and depth are not modelled.
- **Families (all DSL-expressible):** EMA cross (9/21, 20/50, 50/200), SMA cross (10/30, 20/50, 50/200), MACD cross
  (12/26/9, 8/21/5), RSI mean reversion (14/30, 14/25, 7/20, exit at 50), RSI momentum (cross 55 or 60, exit at 50),
  Bollinger reversion and breakout (20, 2 or 2.5 sd, exit at middle), trend filter + pullback (EMA 100/200 filter,
  RSI 14 below 35/40, exit RSI 55), volume breakout (close crosses EMA 20 with volume > 1.5x/2x its 20-bar mean).
  Each long, short and both; stop 0.5/1/2% x target 1/2/4%/none. 9 families x 3 directions x 3 TF x 5 symbols =
  **405 cells**, 12 to 36 configs each, **11,880 configs** in total.
- **Not expressible in the DSL:** Donchian / N-bar high-low breakout (no highest/lowest operator), ATR-based stops
  (stopPct only), time-of-day filters, funding / open-interest / liquidation operands (operands are OHLCV and the
  7 indicators only), position sizing by volatility, trailing stops.
- **Walk-forward.** Per cell, the config with the best in-sample (first 60%) net return (>= 10 IS trades) is the
  only one reported, on the last 40%. Rolling check: series cut in fifths; choose on fifth k-1, test on fifth k
  (4 tests per cell, 1,620 in total).
- **Baselines.** (a) buy-and-hold of the same notional over the same window, minus one round-trip fee; (b) random
  entries at the strategy's own entry rate when flat, random exits at 1/(its average hold), same direction, stop,
  target and costs, 200 runs per cell (p = share of random runs >= the strategy); 5,000 runs for every cell whose
  200-run p was < 0.05; (c) the chosen config re-run at fees x0.5, x1, x2.
- **Multiple comparisons.** 360 cells have >= 30 OOS trades; at p < 0.05 about 18 pass by luck. Benjamini-Hochberg
  (FDR 5%) and Bonferroni on the high-resolution p values.
- **Regimes** (per bar, from the previous 100 bars only): high-vol = top third of rolling return sd; else trend =
  efficiency ratio at or above the series median; else range. Trades are tagged by entry bar.

## 3. Headline results (out-of-sample, net of fees and slippage, % of notional, no leverage)

Overall:

| Measure | Result |
|---|---|
| All 11,880 configs run OOS: net profitable | **12.6%** (1,498) |
| Selected (IS-best) cells profitable OOS | 97 / 405 (24%); with >= 30 trades 79 / 360 |
| Rolling walk-forward tests profitable | 393 / 1,620 (**24%**); 15m 12%, 1h 25%, 4h 36% |
| Selected cells beating buy-and-hold | 258 / 405 (bear-market OOS: see section 1) |
| Selected cells beating the random-entry mean | 224 / 405 (55%) |
| p < 0.05 vs random (>= 30 trades) | 46 / 360 (luck predicts ~18) |
| Survive Benjamini-Hochberg 5% | **3** (below); Bonferroni: **0** |
| Profitable at fees x0.5 / x1 / x2 | 129 / 97 / 67 of 405 |
| IS vs OOS return correlation | 0.54, but median IS +1.3% vs median OOS **-13.9%** (selection decays) |
| Cells with < 30 OOS trades (not meaningful) | 45 (mostly MANTRA 4h, SMA 50/200, trend pullback) |

By family x timeframe (selected cells, 5 symbols x 3 directions each = 15 cells; returns are medians over cells):

| Family | TF | Profitable | Median OOS net | Median random | Median trades | p<.05 | Profit at x2 fees | Median per trade |
|---|---|---|---|---|---|---|---|---|
| EMA cross | 15m / 1h / 4h | 5 / 5 / 8 | -4.2 / -2.2 / **+1.5** | -6.9 / -6.5 / -6.1 | 44 / 40 / 51 | 1 / 1 / 3 | 3 / 4 / 7 | -0.11 / -0.09 / +0.04 |
| SMA cross | 15m / 1h / 4h | 5 / 7 / 11 | -11.8 / -2.3 / **+19.2** | -8.8 / -9.9 / -2.7 | 50 / 57 / 22 | 3 / 2 / 2 | 5 / 4 / 11 | -0.22 / -0.02 / +0.49 |
| MACD cross | 15m / 1h / 4h | 0 / 1 / 9 | -84.9 / -80.3 / +1.3 | -87.9 / -58.8 / -34.9 | 554 / 404 / 211 | 2 / 1 / 7 | 0 / 0 / 3 | -0.15 / -0.15 / 0.00 |
| RSI mean reversion | 15m / 1h / 4h | **0 / 0 / 0** | -12.7 / -24.5 / -37.6 | -16.4 / -17.9 / -17.2 | 109 / 127 / 99 | 0 / 1 / 0 | 0 / 0 / 0 | -0.13 / -0.19 / -0.40 |
| RSI momentum | 15m / 1h / 4h | 0 / 3 / 7 | -47.3 / -29.7 / -4.9 | -49.1 / -42.5 / -23.8 | 303 / 263 / 173 | 0 / 1 / 2 | 0 / 2 / 3 | -0.14 / -0.09 / -0.01 |
| Bollinger reversion | 15m / 1h / 4h | 1 / 3 / **0** | -32.0 / -42.9 / -39.5 | -28.9 / -38.1 / -18.9 | 188 / 219 / 115 | 0 / 2 / 0 | 0 / 3 / 0 | -0.11 / -0.20 / -0.26 |
| Bollinger breakout | 15m / 1h / 4h | 0 / 5 / 5 | -28.7 / -12.6 / -8.2 | -27.5 / -25.4 / -12.0 | 175 / 154 / 107 | 1 / 5 / 3 | 0 / 2 / 3 | -0.17 / -0.07 / -0.08 |
| Trend + pullback | 15m / 1h / 4h | 0 / 4 / 7 | -8.2 / -7.4 / 0.0 | -4.9 / -5.2 / -4.6 | 41 / 52 / 38 | 0 / 0 / 3 | 0 / 4 / 6 | -0.20 / -0.12 / +0.01 |
| Volume breakout | 15m / 1h / 4h | 0 / 4 / 7 | -17.0 / -8.0 / -2.8 | -15.1 / -16.4 / -10.9 | 102 / 107 / 81 | 1 / 3 / 2 | 0 / 1 / 6 | -0.17 / -0.11 / -0.03 |

By timeframe: 15m 11/135 cells profitable (median -19.7%), 1h 32/135 (-14.0%), 4h 54/135 (-4.9%).
By direction: long 26/135, short 37/135, both 34/135 (shorts helped by the bear OOS).
By symbol (profitable cells / 81): BTC 18, ETH 23, SOL 15, LINK 22, MANTRA 19 (MANTRA: only 51 cells with >= 30 trades, 2 with p < .05).

Rolling walk-forward (choose on one fifth, test on the next), profitable share:
EMA cross 4h 30/60 (median +0.6%), SMA cross 4h 30/60 (+0.0%), volume breakout 4h 30/60 (+0.2%), RSI momentum 4h 26/60,
MACD 4h 22/60; everything at 15m at or below 15/60; MACD 15m 0/60, RSI momentum 15m 1/60, volume breakout 15m 1/60.
Long cells were profitable in 67/198 folds where buy-and-hold rose and 49/342 where it fell; short cells 36/198 and 109/342.

## 4. What survived (and why it is still not proof)

The three Benjamini-Hochberg survivors (p = 0.0002 vs 5,000 random runs each):

| Cell | OOS trades | OOS net | At x2 fees | Buy-and-hold | Note |
|---|---|---|---|---|---|
| BTC 1h Bollinger breakout, both, 20/2.5, stop 1 | 289 | +28.7% | **-0.2%** | -47.6% | dies at double fees |
| LINK 15m SMA 50/200 cross, both, stop 1, target 4 | 85 | +45.0% | +36.5% | +17.9% | the same family lost at 15m on the other 4 symbols (median -11.8%) |
| MANTRA 1h Bollinger reversion, long, 2.5 sd, stop 1, target 2 | 60 | +26.7% | +20.7% | -54.2% | 4 months of one thin coin; reversion lost almost everywhere else |

They are three different families on three different symbols and timeframes; none generalises across symbols,
none holds in the rolling test as a family, and Bonferroni rejects all of them. With 405 cells, 46 at p < .05 against
~18 expected says there is *some* non-random structure (mostly slow trend-following in a trending market), not a
reliable rule. Biggest OOS winners were 4h trend rules in the 2024-2026 decline: ETH 4h EMA 20/50 both +125.7%
(82 trades, p 0.007), ETH 4h Bollinger breakout both +96.7% (p 0.006), LINK 4h EMA 20/50 long +72.7%. The same
families were coin flips across rolling folds (30/60 profitable, median about 0).

## 5. What clearly loses

- **Anything on 15m:** 11/135 cells profitable, median -19.7%, rolling 64/540. Fees (0.14% per round trip) exceed the
  median gross move the rules capture; median net per trade -0.16%.
- **RSI mean reversion: 0 of 45 cells profitable** on every timeframe and symbol, and worse than random at 4h
  (-37.6% vs -17.2%). Bollinger reversion: 4/45, worse than random at 4h. Fading moves in a trending market bleeds.
- **MACD cross** trades too often: 400-550 trades per cell at 15m/1h, median -80%..-85% of notional; random entries
  at the same rate do the same, so the loss is the fee bill, not bad timing.
- **High-volatility regimes:** mean net trade -0.22% (16,052 trades) vs -0.09% trend and -0.07% range. Only SMA
  cross in range (+0.25%, n 1,346) and trend (+0.18%), EMA cross in range (+0.14%), and trend pullback in trend
  (+0.13%, n 560) were positive by regime; RSI reversion in trend -0.32%, trend pullback in range -0.41%.
- **Selection itself:** the IS-best config lost a median 13.9% OOS. Tuning on the 1000 candles the app backtests on
  is curve fitting; the app's own caveat ("in-sample and likely overfit") is accurate.

## 6. Where bots did less badly: risk shape, not alpha

- **Drawdown:** 331/405 selected cells had a smaller OOS max drawdown (% of notional, no leverage) than buy-and-hold
  (median 29.8% vs 68.9%). Mostly because they were out of the market much of the time.
- **Long-only vs holding:** when buy-and-hold fell, long-only rules lost less than holding in 82/117 cells; when it
  rose, they beat holding in only 5/18. A stop-protected long rule is downside insurance that costs the upside.
- **Slow trend on 4h** (EMA/SMA cross, volume breakout) was the only area with a median OOS result near or above
  zero after costs, and its rolling record is 50% profitable folds. Consistent with "good stretches in trends, long
  flat-to-losing ones", not with a dependable edge.

## 7. Leverage and risk of ruin

Fixed notional, margin = notional / leverage, equity on margin = leverage x cumulative net % of notional, over each
selected cell's OOS trade path:

| Leverage | Lost >= 25% of margin | Lost >= 50% | Wiped out (>= 100%) | Worst single trade on margin |
|---|---|---|---|---|
| 1x | 176 / 405 | 77 | 14 | -2.2% |
| 2x | 280 | 176 | 77 | -4.4% |
| 3x | 324 | 242 | 144 | -6.6% |
| 5x | 353 | 299 | **216 (53%)** | -11.0% |

Stops of 0.5-2% kept every single trade far from the ~-20% liquidation distance at 5x; ruin comes from the **sum of
many small stopped-out losses plus fees**, which leverage multiplies. At 5x a fee-only drag of -0.14% per round trip
is -0.7% of margin per trade; 100 trades cost 70% of the margin before any price loss. Leverage does not change
whether a rule has an edge; it only changes how fast a zero-edge rule reaches zero.

## 8. The user goal: "+$10 on $20 in 15 minutes to 1 hour"

$20 margin at 5x = $100 notional, so +$10 needs **+10% price** (about +10.15% after fees and slippage). Base rates
from every 15m candle open over the past year (about 35,000 windows per symbol; windows overlap, so one big move is
counted several times):

| Symbol | +10% touched within 15m | within 1h | -10% first within 1h | +0.5% within 1h (long) | +1% | +2% | either side +-1% within 1h |
|---|---|---|---|---|---|---|---|
| BTC | 0% | 0% | 0% | 18.0% | 4.9% | 0.74% | 10.0% |
| ETH | 0% | 0.009% | 0% | 26.8% | 8.9% | 1.8% | 17.9% |
| SOL | 0% | 0% | 0.023% | 32.4% | 10.8% | 2.3% | 22.2% |
| LINK | 0% | 0% | 0.023% | 36.3% | 12.1% | 2.3% | 24.1% |
| MANTRA (thin) | 0.035% | 0.26% | 0.15% | 47.7% | 20.9% | 5.3% | 41.0% |

Over 3 years of 1h candles BTC never rose 10% inside one hour (0 / 26,279) and fell 10% once. The honest answer
is that the goal is effectively not available on majors and is a coin-flip-or-worse lottery on thin alts, where the
-10% side happens about as often. A touch is not an edge: a +1% touch within the hour is roughly as likely as a -1%
touch, so a 1% target with a 1% stop has a negative expectation after the 0.14% round-trip cost. Realistic
"within the hour" moves are +0.5% to +1% of notional (at 5x on $20: about $0.40 to $0.90 after costs), with the
same chance of the matching loss.

## 9. Bottom line for users

- **No rule family the DSL can express made money reliably after costs out of sample.** 12.6% of all configs and
  24% of walk-forward tests were profitable; after multiple-comparison correction three isolated cells survive, one
  of them only at today's fees. That matches the plan's prediction; we could not falsify it.
- **Where a bot helps:** following a written rule without hesitation; a stop on every trade; staying out of the market
  (smaller drawdowns than holding in falling markets); automating a slow (1h/4h) rule you want to watch; learning
  how fees, stops, leverage and overfitting behave, with no money at risk.
- **Where it does not:** short timeframes (fees eat the move), mean reversion in trending markets, frequent signals
  (MACD on 15m/1h), tuning parameters on recent data, leverage as a way to reach a profit goal, and "+X dollars in
  Y minutes" goals.
- User-facing wording should stay as the plan says: "consistent with no edge", sample size next to every number,
  fees shown next to net P&L, no projected returns.

## 10. Caveats and what this study could not check

- One OOS period per series, mostly a falling market; results for longs/shorts would differ in a bull run. The rolling
  test covers 2020-2026 at 4h but only 1 year at 15m.
- No funding (real longs often paid 10%+ a year in bull phases), no spread or depth, no partial fills; real results
  would be worse than these paper numbers. Leverage modelled as linear scaling of notional returns (no compounding,
  no liquidation price beyond the per-trade check).
- Random baseline uses a geometric holding time; the strategies' holds are less dispersed. p values are a guide,
  not exact. Regime labels use whole-series thresholds (descriptive only).
- MANTRA has 9 months of perp history; its 4h cells are mostly under 30 trades and its results are dominated by a
  few large moves.
- The app's `/api/market/futures/klines` route could not be used for history (1000-row cap, no paging) and
  `127.0.0.1:4000` was not reachable from the study sandbox; candles came directly from Binance's fapi.
- Raw per-cell numbers: `context/bot-capability-results.json` (cells, rolling rows, regime trades);
  base rates: `context/bot-goal-baserates.json`; prompt starters: `context/bot-prompt-templates.json`.
