# Bot trading plan (paper bots driven by the strategy DSL)

Status: PLAN, 2026-11-26. Nothing here is built. Written from a read of `context/*`, `services/strategy/*`, `controllers/futuresController.js`, `services/{futuresLedger,riskEngine,orderMatcher,tradeFill,alertService}.js`, `routes/{strategyRoutes,agentRoutes}.js`, `services/ai/*`, `components/ai/Strategy*.jsx`.

One-line design: **a bot = one accepted, hashed strategy spec + one symbol + one interval + hard limits, ticked by a deterministic in-process engine that places ordinary paper futures orders through the existing ledger path. The LLM only writes proposals and explanations.**

## 1. Effectiveness: honest assessment

### What edge is realistic

| Claim | Honest answer |
|---|---|
| Will DSL bots make money? | **Expect about zero before costs and negative after costs.** The DSL expresses public indicator rules (EMA/SMA cross, RSI, Bollinger, MACD, ATR, volume) on liquid perps. These are the most-tested rules in existence; any durable edge in them is arbitraged away. |
| What can they do? | Change the *shape* of returns: less time in the market, smaller drawdowns than buy-and-hold in downtrends, worse in strong uptrends. Trend rules have had good stretches in trending regimes and long flat-to-losing ones. That is risk shaping, not alpha. |
| What does the LLM add? | Turns a user's idea into a valid spec and explains decisions in plain language. **It is not a source of edge.** Asking it to "tune" is automated curve fitting. |
| What is the product value? | Learning, rule discipline, and an honest forward test of an idea with no money at risk. We must sell it as that. |

### Failure modes and what we do about each

| Failure mode | Why it bites here | Mitigation in this plan |
|---|---|---|
| Overfitting | Backtest is in-sample on <= 1000 candles; every "tune" is another draw from the same data | Existing caveats always shown; tune count (`generation`) shown on the bot; older-half vs newer-half stats before accept; forward paper results are the only number we headline |
| Look-ahead | Acting on a forming candle, or indicators reading bar i+1 | Live signals come from the **same interpreter** as the backtest (`computeSeries`/`groupSignals`), on closed bars only; parity test (section 5, WP1) |
| Fees and slippage | 5 bps per side = 10 bps round trip. A 5m rule trading 10 times a day pays ~1% of notional per day | Minimum interval 5m; `maxTradesPerDay` limit; fees shown as a share of gross P&L; fee total always next to net P&L |
| Funding | Paper futures ignore funding (`fundingIgnored: true`). Real longs in bull regimes often pay 10%+ a year on notional | Disclaimer on every bot screen; not simulated in v1 (open question 3) |
| Paper fills are optimistic | Fill at the mark with no spread, no depth, no partial fills, no rejects | Stated in the disclosure text the user accepts; "paper fill" label on every trade |
| LLM nondeterminism | Same prompt gives different specs | Irrelevant at run time: the spec is frozen and hashed at accept; the engine never calls a model |
| Latency | Engine ticks every 5 s; candles can lag the close; Render free tier sleeps | Bars >= 5m make seconds irrelevant; missed bars are logged as `missed`, never traded late; drift is measured (below) |
| Runaway losses | A bad rule in a fast market | Mandatory stop on every bot position (enforced by the existing 1 s risk engine even if the bot engine is dead), daily loss kill switch, max trades per day, max position, max leverage, global `BOTS_ENABLED` switch |
| Over-trusting paper results | Users read a green number as proof | Sample-size label and confidence interval next to every return; "consistent with zero" wording; no leaderboards, no "win rate" headline, no projected returns |

### What we will measure (per bot, forward only, from the accept time)

| Metric | Definition | Source |
|---|---|---|
| Net P&L (cents) | Sum of `realizedPnl - fees` over the bot's closed positions + unrealized on the open one at the server mark | `Position` rows with `botId` (already ledger-settled; no second bookkeeping) |
| Buy-and-hold benchmark | Same `sizeUsd` notional bought at the mark recorded at first start, held to now, minus one entry fee and one hypothetical exit fee | `Bot.startMark`, current `fillPrice` |
| Fees paid, and fees / gross P&L | Cents | positions |
| Trades n, win rate, profit factor, average trade, max drawdown, exposure % | Same definitions as `backtest.stats` so the two tables line up | positions + decisions |
| Sample-size label | n < 30: "Too few trades to mean anything"; 30..99: "Weak evidence"; >= 100: no label. Always: mean trade return with a 95% interval (`mean +/- 1.96 * sd / sqrt(n)`); if it spans 0: "Consistent with no edge" | pure function |
| Backtest vs live drift | (a) per trade: live fill price vs the backtest's fill for the same signal (next bar open with slippage), in bps; (b) over the live window: `evaluate()` total return on the same candles vs realised return; (c) counts of `missed` bars and guard `skip`s | `BotDecision` + `evaluate` |

Example of why the label matters: with a 2% per-trade standard deviation and 30 trades the standard error is 0.37% per trade. An edge of 0.1% per trade is invisible at that size. The UI says so in words.

## 2. Architecture

### Scope decisions (v1)

- **Futures only, one symbol, one position at a time, market orders, fixed notional, no adds, no compounding.** This mirrors the backtest simulator exactly, so drift is measurable. Spot bots: not in v1 (long-only, second engine path, no stop engine).
- Interval: `5m, 15m, 1h, 4h, 1d` (the spec's own timeframes minus 1m). Pinned at creation.
- A bot spec **must** have `risk.stopPct`. No stop, no accept.
- Caps (constants in `services/bot/riskGuard.js`): 5 bots per user, 3 running per user, 200 running in the process, leverage <= 5, `sizeUsd` <= $25,000.

### Data model

`models/Bot.js`

| Field | Notes |
|---|---|
| `userId`, `name` (<= 60) | owner from the JWT only |
| `strategyId?`, `spec`, `specHash` | spec copied in after `parseSpec`; the bot does not follow later edits of the saved Strategy |
| `symbol` (base ticker `BTC`), `interval` | |
| `sizeUsd`, `leverage` | order parameters |
| `limits` `{ maxPositionUsd, maxLeverage, dailyLossUsd, maxTradesPerDay, symbols: [..] }` | all required; `symbols` must contain `symbol` and be a subset of the server allow-list (v1: top-40 overview symbols at create time) |
| `status` | `proposed`, `declined`, `paused`, `running`, `stopped`, `killed` |
| `acceptedHash`, `acceptedAt`, `disclosureVersion` | `acceptedHash = sha256(canonical{specHash, symbol, interval, sizeUsd, leverage, limits})`; reuse `canon`/`hashOf` from `strategyRoutes.js` (move both to `services/strategy/hash.js`) |
| `generation` | how many LLM tunes led to this spec (0 = first proposal or user-written) |
| `lastBarTime` | open time (s) of the last closed bar already decided; the per-bar claim |
| `positionId`, `entryBarTime` | the bot's open position, if any |
| `day` `{ key: 'YYYY-MM-DD' (UTC), trades, realizedCents }` | counters for the daily limits |
| `startMark`, `startedAt`, `errors`, `stopReason`, timestamps | |

`models/BotDecision.js` (the audit log; append-only)

| Field | Notes |
|---|---|
| `botId`, `userId`, `at` | |
| `kind` | `tick` (one per bar), `risk` (kill switch, limit hit), `observed` (TP/SL/liquidation/manual close seen), `lifecycle` (accept, start, pause, stop, decline, by whom) |
| `barTime` | for `tick`; **unique partial index `{botId, barTime}`** where `barTime` is a number |
| `action` | `open_long`, `open_short`, `close`, `hold`, `skip`, `missed` |
| `status` | `intent`, `done`, `failed`, `abandoned` (only orders use `intent`) |
| `reason` | built in code, never model text: `{ signal, conds: [{ text, left, right, ok }], guard?: code, detail? }` |
| `positionId`, `mark`, `fillPrice`, `feeCents`, `pnlCents`, `candlesSource` | |
| `expiresAt` | TTL index (`expires: 0`): `hold` rows 14 days, everything else 365 days |

`models/Position.js`: add optional `botId` (declared in the schema, strict mode drops undeclared paths) and `'bot'` to the `closeReason` enum. No other model changes. `FuturesOp.kind` is unchanged (`open`, `close`).

### Orders go through the existing path (no second money path)

`marketOpen` and `closePosition` in `futuresController.js` take `res`. Extract them unchanged into `services/futuresOrders.js`:

```
openMarket({ userId, symbol, side, size, leverage, tp, sl, positionId?, botId?, noAdd? }) -> { position, fill: { price, feeCents } }
closeMarket({ userId, positionId, size?, reason = 'manual' })                              -> { position, close: { price, pnlCents, feeCents, creditCents } }
```

Both keep every existing check (`markNow` -> `fillPrice`, min notional, `checkLeverage`, `checkTpsl`, max positions, `ledger.run`, `ledgerFail`) and throw the same `ApiError`. The controller becomes a thin HTTP wrapper with identical responses. New optional inputs: a caller-supplied `positionId` (the ledger already takes the id from the spec), `botId` (written in the `create` doc), `noAdd` (existing position on the `activeKey`, or `onDuplicate`, fails with 409 `POSITION_CONFLICT` instead of becoming an add). The bot engine calls only these two functions. It never imports `futuresLedger`, `futuresMath` quotes, or `User`.

Signal to order mapping (same rules as `backtest.simulate`):

| State | Signal on the last closed bar | Order |
|---|---|---|
| flat | `entry.long` true (long wins over short, as in the simulator) | `openMarket` long, `size = round8(sizeUsd / mark)` floored so notional <= `sizeUsd`, `sl = fill * (1 - stopPct/100)`, `tp` from `targetPct` if set |
| flat | `entry.short` true | same, short |
| in position | matching `exit` group true, or bars held >= `risk.maxBars` | `closeMarket` whole position, reason `bot` |
| in position | otherwise | `hold` |

Stops and targets are **position TP/SL**, so the existing risk engine executes them on the mark at 1 s, with liquidation > SL > TP precedence, independent of the bot engine. The bot engine learns about it on its next pass (position no longer open) and writes an `observed` decision with the position's `closeReason`.

### Tick loop: `services/bot/botEngine.js`

Same shape as `orderMatcher` (`start/stop/runOnce`, one in-flight pass, timer `unref`, skip unless Mongo is up, `_test` object). `EVERY_MS = 5000`. Started and drained in `server.js` after `riskEngine`. Off when `BOTS_ENABLED=false` (default on in development, **off in production until the owner turns it on**).

Per pass:
1. `recoverIntents()` (below).
2. Load `Bot{status:'running'}` (<= 200, `_id` cursor rotation like `riskEngine.nextPage`).
3. For each bot, in order:
   - **Integrity**: recompute `acceptedHash`; mismatch -> `paused`, `risk` decision `hash_mismatch`. Re-run `parseSpec`.
   - **Own position check**: if `positionId` is set and that position is not `open` -> `observed` decision, add its net P&L to `day.realizedCents`, clear `positionId`.
   - **Kill switch** (every pass, not only on bar close): `day.realizedCents + unrealizedCents(mark) <= -dailyLossCents` -> `closeMarket`, status `killed`, `risk` decision. No fresh mark -> skip this check this pass (never act on a stale mark); the position's SL still protects it.
   - **Bar gate**: `barTime = floor(now / iv) * iv - iv`. If `lastBarTime >= barTime` -> nothing (no network, no DB write).
   - **Candles**: `futuresRest.klines(symbol, interval, 500)` (already cached 10 s, shared by all bots on that pair). Require a candle with `time === barTime`. Missing: retry next pass until `barTime + iv + 60 s`, then write `missed` and move on. Source gate: see open question 1 (default: Binance-sourced candles only, else `skip: candles_source`).
   - **Signal**: `signalAt(spec, candles, { interval, now })` -> `{ barTime, entryLong, entryShort, exitLong, exitShort, conds }`.
   - **Guard**: `riskGuard.check(bot, { position, mark, day }, intent)`.
   - **Claim + act** (idempotency below).
4. Errors: a throw on one bot is logged, counted in `Bot.errors`, never stops the pass. 10 consecutive failures -> `paused` with `stopReason: 'errors'`.

### Risk guard: `services/bot/riskGuard.js` (pure, cents)

`check(bot, state, intent) -> { ok: true } | { ok: false, code }`. Entries are blocked by any failing rule; **exits are never blocked** by a limit.

| Rule | Code |
|---|---|
| `symbol` in `limits.symbols` and still a known, allow-listed perp | `SYMBOL_NOT_ALLOWED` |
| `leverage <= limits.maxLeverage <= 5`, and <= `futuresMath.maxLeverage` | `LEVERAGE_LIMIT` |
| order notional cents <= `limits.maxPositionUsd` cents (ceil the notional, so rounding never lets it through) | `POSITION_LIMIT` |
| `day.trades < limits.maxTradesPerDay` | `TRADES_LIMIT` |
| `day.realizedCents + unrealizedCents > -dailyLossCents` | `DAILY_LOSS` (also the kill switch) |
| worst case of this trade `ceil(notional * stopPct/100) + 2 fees` fits inside the remaining daily loss budget | `LOSS_BUDGET` |
| stop is inside the liquidation price for this leverage | `STOP_BEYOND_LIQ` (also checked at accept, so it cannot be accepted) |
| a position on `userId:symbol:side` exists that is not this bot's | `POSITION_CONFLICT` |

`validateLimits(input, serverCaps)` in the same file is used by the routes at create/edit/accept. The trade counter is a conditional claim, not a read-then-write: `Bot.findOneAndUpdate({ _id, 'day.key': today, 'day.trades': { $lt: max } }, { $inc: { 'day.trades': 1 } })`; a different `day.key` is rolled first with its own conditional update.

### Restart and idempotency (no double fills)

One decision per bot per bar, written **before** the order, carrying a pre-generated position id:

1. Insert `BotDecision{ kind:'tick', barTime, action, status:'intent', positionId: new ObjectId() }`. The unique `{botId, barTime}` index is the claim: E11000 means this bar was already decided -> stop. `hold`/`skip`/`missed` rows are inserted as `done` in this same step.
2. Advance `Bot.lastBarTime` with a conditional update (`lastBarTime < barTime`).
3. Entry: claim the trade counter, then `openMarket({ positionId, botId, noAdd: true, ... })`. The ledger creates the position with that `_id`, so the same intent can never produce two positions. Exit: `closeMarket` (its `expect: { status:'open', size, rev }` makes a second close a no-op `NOT_OPEN`).
4. Update the decision to `done` (fill price, fee, pnl) or `failed` (code), and set/clear `Bot.positionId`.

`recoverIntents()` (start of every pass, rows older than 30 s, which is past the ledger's 15 s recovery gate):

| Intent | Position by the stored id | Result |
|---|---|---|
| open | `open` | adopt: `Bot.positionId = id`, decision `done` |
| open | `opening` or locked | leave; the risk engine's `recoverAll` is rolling it forward or back |
| open | absent or `void` | decision `abandoned`. **Entries are never retried**: the bar has passed |
| close | not `open` | decision `done` |
| close | `open`, unlocked | **retry the close at the current mark** (reduce-only, cannot double) |

Crash at any point therefore gives at most one fill per bar, and a late exit rather than a lost one. A crash between steps 1 and 3 costs one missed entry, which is the safe side.

Other failure handling: `NO_PRICE`/502 candles -> `skip` with the code, retried next bar only; `INSUFFICIENT_BALANCE` -> `failed`, bot keeps running (3 in a row -> `paused`); `POSITION_BUSY` on close -> leave the intent for recovery; account locked or deleted -> bots set `stopped` (account delete also refuses while a bot is `running`, then deletes `Bot` + `BotDecision`; export includes both). Server asleep (Render free tier): no ticks, bars are `missed` on wake, open positions keep their SL/TP only while the process is up, which is already true for manual positions. The UI says "bots only run while the server is awake".

## 3. The LLM's role

| It may | It may not |
|---|---|
| Propose a strategy spec in chat (existing `wantStrategy` path, strict `parseSpec`) | Place, size, time or cancel any order |
| Propose a *tuned* spec for an existing bot (new proposal, `generation + 1`, must be accepted again; never applied to a running bot) | Set or change limits (limits come from server defaults and the user's form only) |
| Explain a decision or a period on request, from numeric decision rows | Write the `reason` of record (that is code-generated) or see anything that is not allow-listed numbers |

Rules, enforced in code and tests:
- `botEngine.js`, `riskGuard.js`, `futuresOrders.js` do not `require` anything under `services/ai/`, `aiService`, `aiProviders` or `services/news`. A test reads those files' `require` lists and fails on a match.
- `services/ai/botContext.js` builds the model's DATA block the same way `agentContext.js` does: allow-listed numeric fields, size bound, no upstream free text. It includes `describe(spec)` (generated in code from validated ids), limits, performance numbers and the last N decisions' numeric fields. It excludes bot names, strategy `name`/`description`, conversation text from other features, and **news headlines and summaries (never in any AI context, as decided 2026-11-26)**.
- The explain/tune calls reuse the single-shot, no-tools agent (`agentService.chat` pattern, same rate limits and daily cap). The reply is inert JSON; a tuned spec goes through `parseSpec` and lands as a `proposed` bot.
- The tune prompt and the UI both say: every tune fits the past harder.

Explicit non-goal: an LLM deciding trades tick by tick. It would be non-reproducible, unauditable, slow, costly and an injection surface, with no evidence of edge.

## 4. API and UI

### Routes: `/api/bots` (mounted in `server.js` with `auth`, like `/api/strategies`; writes 30/min/user; body keys whitelisted; other users' bots are 404)

| Route | Does |
|---|---|
| `GET /config` | server caps, allowed symbols and intervals, disclosure text + version |
| `GET /` , `GET /:id` | list / detail with status, limits, open position, today's counters |
| `POST /` `{ strategyId \| spec, symbol, interval?, sizeUsd, leverage, limits, name? }` | creates a `proposed` bot; returns `describe`, backtest (`evaluate`), worst-case loss per trade, `acceptHash` to sign. 409 `BOT_LIMIT` at 5 |
| `PUT /:id` | edit name/size/leverage/limits when not `running`; clears acceptance (back to `proposed`) |
| `POST /:id/accept` `{ acceptHash, ack: true }` | hash must equal the server's current one (the user approves exactly what will run); records `acceptedAt`, `disclosureVersion`; status `paused` |
| `POST /:id/decline` | status `declined` (terminal) |
| `POST /:id/start` | needs a valid acceptance, < 3 running, `BOTS_ENABLED`; records `startMark` on first start; status `running` |
| `POST /:id/pause` | status `paused`: engine stops acting; the open position stays, protected by its SL/TP |
| `POST /:id/stop` | status `stopped`, then `closeMarket` on its open position |
| `POST /stop-all` | the user's kill switch: stop every bot and close their positions |
| `GET /:id/decisions?before&limit&kind` | paged audit feed (limit <= 100) |
| `GET /:id/performance` | section 1 metrics, benchmark, drift, labels |
| `POST /:id/explain`, `POST /:id/tune` | LLM, phase 6 |
| `DELETE /:id` | only when not `running` and no open position; decisions stay until TTL |

Every status change is a conditional update on the current status (claim, then act) and writes a `lifecycle` decision.

### UI (`frontend/src`)

- New protected page `/bots` (`pages/Bots.jsx`, nav entry in `components/shell/nav.jsx`, route in `App.js`). Components in `components/bots/`: `BotList`, `BotForm` (strategy pick, symbol, interval, size, leverage, limits with server caps), `BotAccept` (the approval screen), `BotDetail`, `DecisionFeed`, `BotPerformance`. Data with `usePolling` at 5 s (same as the rest of the app; no socket).
- Create from chat or a saved strategy: a "Create bot" button on `StrategyCard` and `StrategyList` that opens `BotForm` with the spec.
- `BotAccept` shows, before the Accept and Decline buttons: the code-generated `describe`, the limits, worst-case loss per trade and per day in dollars, the backtest with all caveats, older-half vs newer-half stats, and the disclosure text. Accept is disabled until a checkbox is ticked.
- `BotDetail`: status, Start / Pause / Stop, a red "Stop all bots" kill switch in the page header, open position, today's trades and loss vs limits, live decisions feed (each row: time, action, reason conditions with their values, guard code, fill), P&L vs buy-and-hold with the sample-size label, fees, drift.
- `PositionsTable`: a small "bot" badge on positions with `botId`.
- Disclosure (single source: `GET /api/bots/config`): "Paper money only. Fills are simulated at the mark price with no spread or depth, and funding is not charged, so real results would be worse. Backtests are fitted to the past. Forward results on few trades are noise. Not financial advice. Bots run only while the server is awake." Never: projected returns, rankings, "profitable" badges.

## 5. Phased plan (work packages)

Owners: **Sonnet 5.5 implements, Opus 5.5 reviews every package** (adversarial review on WP0, WP2, WP3: money and concurrency). Haiku runs test suites. All tests use the in-memory fakes and in-process dispatch from `CONVENTIONS.md`; no ports, no network. Every package ends with `cd backend && npm test` green (and the frontend commands for WP5).

| WP | What | Files | Required tests (must fail without the logic) | Done when |
|---|---|---|---|---|
| **0** Order service extraction (no behaviour change) | Move `marketOpen`/`closePosition` bodies into `services/futuresOrders.js`; add `positionId`, `botId`, `noAdd`, `reason`; `Position.botId`, `closeReason: 'bot'` | `services/futuresOrders.js` (new), `controllers/futuresController.js`, `models/Position.js`, `tests/futuresOrders.test.js` (new) | `openMarket` twice with the same `positionId` -> one position, balance debited once; `noAdd` with an existing position -> `POSITION_CONFLICT`, balance unchanged; two concurrent `closeMarket` -> one credit; ledger crash injected mid-open then `recoverAll` -> debited exactly once | `futuresApi.test.js`, `futuresLedger.test.js`, `riskEngine.test.js` pass **unmodified** |
| **1** Live signal function | Export `signalAt` from `services/strategy/evaluate.js`, reusing `computeSeries`/`groupSignals`; returns per-condition values for the reason | `services/strategy/evaluate.js`, `tests/strategy.test.js` | Parity: for every bar i of a fixture, `signalAt(candles[0..i])` equals the signal the simulator used at i; appending later candles never changes it; a still-forming last candle is ignored | independent of WP0 |
| **2** Models, risk guard, routes (no engine) | `Bot`, `BotDecision`, `riskGuard.js`, `/api/bots` CRUD + accept/decline/start/pause/stop/stop-all + decisions; hash helper moved to `services/strategy/hash.js`; export and account delete | `models/Bot.js`, `models/BotDecision.js`, `services/bot/riskGuard.js`, `services/strategy/hash.js`, `routes/botRoutes.js`, `routes/strategyRoutes.js`, `server.js`, `controllers/authController.js`, `.env.example`, `tests/riskGuard.test.js`, `tests/botRoutes.test.js` | Each guard rule at its boundary in cents (limit exactly met vs 1 cent over); accept with a stale hash -> 409; edit after accept -> start refused; start without accept refused; spec without `stopPct` cannot be accepted; two concurrent starts at the 3-running cap -> one wins; trade counter: two concurrent claims at `max - 1` -> one wins; foreign bot id -> 404 | bots can be created and approved but nothing trades |
| **3** Bot engine | Tick loop, intent/recovery, kill switch, observed exits, wiring | `services/bot/botEngine.js`, `server.js`, `tests/botEngine.test.js` | Same bar ticked twice (and two overlapping passes) -> one order; crash injected after intent insert, after counter claim, after `openMarket`, before decision update, then restart -> exactly one position and one debit, or none and `abandoned`; close intent with a still-open position is retried once; kill switch closes and sets `killed` at exactly the limit; no fresh mark -> no action; missing bar -> `missed`, no late entry; manual close of the bot's position -> `observed`, no re-entry on the same bar; user position on the same side -> `POSITION_CONFLICT`, no add; engine modules do not import AI or news code | a bot runs end to end against fakes; `BOTS_ENABLED=false` makes `start()` a no-op |
| **4** Performance and drift | `services/bot/performance.js` (pure math + one query), `GET /:id/performance` | `services/bot/performance.js`, `routes/botRoutes.js`, `tests/botPerformance.test.js` | Net P&L equals the sum of ledger credits minus debits for the bot's positions in a fixture (to the cent); benchmark fee rounding goes against the user; label thresholds 29/30/99/100; interval spanning zero -> "Consistent with no edge" | numbers match a hand-worked fixture |
| **5** Frontend | Page, components, buttons on strategy card/list, badge | `pages/Bots.jsx`, `components/bots/*.jsx`, `components/ai/StrategyCard.jsx`, `components/ai/StrategyList.jsx`, `components/trade/PositionsTable.jsx`, `components/shell/nav.jsx`, `App.js`, tests next to components | Accept disabled until the checkbox is ticked; disclosure and caveats always rendered; Stop all posts once; sample-size label rendered for n < 30 | `CI=true npm test -- --watchAll=false` and `CI=true npm run build` green; checked in the browser at phone and `xl` widths |
| **6** LLM explain and tune | `botContext.js`, two routes, UI buttons | `services/ai/botContext.js`, `routes/botRoutes.js`, `components/bots/BotDetail.jsx`, `tests/botContext.test.js` | Context contains only allow-listed numeric fields (a bot named with injection text never appears); tuned spec lands as `proposed` with `generation + 1` and cannot start without a new accept; rate limits shared with the agent | optional; ship 0-5 first |
| **7** Docs | `ARCHITECTURE.md` module map + lifecycle, `DOMAIN.md` bot rules, `DECISIONS.md` entries, `GOTCHAS.md`, `TODO.md`, `README.md` API table | `context/*.md`, `README.md` | none | done with each package, checked at the end |

Order and parallelism: WP0, WP1 and WP2 are independent and can run in parallel. WP3 needs 0+1+2. WP4 needs 2 (fixtures) and is independent of 3. WP5 needs the route shapes from 2 and 4. WP6 last.

No new dependencies anywhere (zod, mongoose, express, crypto, existing limiter and polling hooks cover it).

## 6. Risks and open questions for the owner

| # | Question | Recommended default |
|---|---|---|
| 1 | **Which candles may produce a signal?** On Render, Binance futures REST is blocked, so klines usually come from Bybit/Bitget/Gate/MEXC or the Binance spot mirror. Fills stay at the Binance mark either way, so the hard rule holds, but a signal from a foreign venue's candle is the same kind of thing the rule forbids for alerts. | Binance-sourced candles only (`binance-futures`, else the Binance `spot` mirror); otherwise `skip: candles_source` and show it in the feed. On Render this means spot candles drive signals; say so in the bot detail. Revisit if bots skip too often. |
| 2 | **Enable in production now?** The free Render instance sleeps and the keepalive cron can lag 5-15 min, so bots miss bars and stops are not watched while asleep. | Ship with `BOTS_ENABLED=false` in production; turn it on only on an always-on instance. Local and demo use works today. |
| 3 | **Simulate funding?** Ignoring it flatters every bot that holds for days. Adding it is a new scheduled money path through the ledger. | Not in v1. Disclose on every screen; later add a display-only "estimated funding you would have paid" line from funding history (analytics only, never moves money). |
| 4 | **Default limits and caps.** | Defaults in the form: size $1,000, leverage 1x, daily loss $50, 10 trades/day. Hard caps: leverage 5x, size $25,000, 5 bots per user, 3 running. Owner can change the constants. |
| 5 | **How far may the LLM go?** Tick-by-tick LLM trading and auto-applied tuning were left out on purpose. | Keep it to propose, tune-as-new-proposal and explain. Any tuned spec needs a fresh accept. |

Residual risks we accept in v1: paper fills at the mark are optimistic and nothing in the design fixes that, only discloses it; a user adding manually to a bot's position changes that position's size and P&L attribution (the bot still closes the whole position); count-then-insert caps (5 bots) can overshoot by one under parallel requests, like the existing caps.
