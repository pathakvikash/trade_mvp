# API reference

Moved out of the README to keep it short. Overview and conventions: [`README.md`](../README.md#api-overview).


Base URL: `http://localhost:4000`. "Auth" = `Authorization: Bearer <jwt>`. Errors use `{ success:false, message }` (futures adds `code`; alerts/AI/market use `{ error }`).

## Auth (`/api/auth`)

| Method | Path | Auth | Purpose | Limit (per IP unless noted) |
|---|---|---|---|---|
| POST | `/register` | no | Create account (always role `user`) | 5/hour |
| POST | `/login` | no | Email + password -> `{token, user}` | 10/min |
| POST | `/google` | no | Google ID token -> `{token, user}` | 10/min |
| GET | `/config` | no | `{googleClientId}` | none |
| GET | `/dev-hint` | no | Demo credentials; 404 unless development + seeding + loopback | 30/min |
| GET | `/verify` | yes | Validate token, return user | none |
| GET | `/me` | yes | `{user, aiModels, aiProviders, aiDefaultPrompt, aiServerRules}` (never keys or hashes) | none |
| PATCH | `/me` | yes | Update `name`, `profile`, `preferences`, `ai` (provider, model, systemPrompt, temperature, length, includePortfolio, providers model/baseUrl); keys are not settable here; unknown keys -> 422 | none |
| PUT | `/me/avatar` | yes | `{avatar}`: `emoji:<emoji>` or `data:image/jpeg\|webp;base64,...` (<= 150KB decoded, magic bytes checked) | 20/min/user |
| DELETE | `/me/avatar` | yes | Back to initials | 20/min/user |
| POST | `/password` | yes | Change password (Google-created accounts may omit `currentPassword` within 10 min of sign-in, else `REAUTH_REQUIRED`); returns a fresh token, revokes older ones | 5/min |
| POST | `/logout-all` | yes | Bump `tokenVersion`, return a fresh token for this session; other sessions and their `/alerts` sockets are dropped | 5/min/user |
| GET | `/me/export` | yes | JSON download: profile, settings (no secrets), trades, orders, positions, futures orders, alerts | 5/min/user |
| DELETE | `/me` | yes | `{confirmEmail}`: locks the account, then deletes all its data. 409 `OPEN_FUTURES` while positions are opening/open, futures orders placing/open, or ops pending/error. 500 on partial failure leaves the account locked for manual cleanup | 3/min/user |

## Spot trading

| Method | Path | Purpose | Limit |
|---|---|---|---|
| POST | `/api/trades` | Place spot order `{cryptoSymbol, type: buy/sell, amount, orderType?: market/limit, limitPrice?}` | 30/min/user |
| GET | `/api/trades?limit=` | Own trades, newest first (1..100) | none |
| GET | `/api/trades/portfolio` | `{balance, holdings:[{symbol, amount, avgCost}]}` | none |
| GET | `/api/orders` | Open spot limit orders + last 20 closed | none |
| DELETE | `/api/orders/:id` | Cancel an open limit order, release reservation | 60/min/user |

## Futures trading (`/api/futures`, all authenticated)

| Method | Path | Purpose | Limit |
|---|---|---|---|
| GET | `/config` | Fee rate, min notional, caps, leverage tiers, `fundingIgnored` | none |
| GET | `/positions` | `{positions: open (with busy, markPrice), closed: last 20}` | none |
| GET | `/orders` | `{orders: open limit entries, closed: last 20}` | none |
| POST | `/orders` | Open/add (market) or place limit entry `{symbol, side: long/short, type, size, leverage, limitPrice?, tp?, sl?}` | 30/min/user |
| PATCH | `/orders/:id` | Set/clear `tp` / `sl` on an open limit entry (price/size/leverage: cancel and re-place) | 30/min/user |
| DELETE | `/orders/:id` | Cancel a limit entry, credit the reservation | 30/min/user |
| POST | `/positions/:id/close` | Close all, or `{size}` partially, at mark | 30/min/user |
| PATCH | `/positions/:id` | Set/clear `tp` / `sl` (`null` clears) and/or change `leverage` (re-sizes isolated margin: releases or debits the difference); all applied together or none | 30/min/user |

Futures error codes: `INSUFFICIENT_BALANCE`, `MIN_NOTIONAL`, `LEVERAGE_TOO_HIGH`, `LEVERAGE_MISMATCH`, `MAX_POSITIONS`, `MAX_ORDERS`, `BAD_TPSL`, `LIQ_BREACH` (leverage change would put liq at/through the mark), `BAD_SIZE`, `UNKNOWN_MARKET`, `NOT_FOUND`, `NOT_OPEN`, `POSITION_BUSY` (retry), `NO_PRICE` (503), `OP_FAILED` (500), 422 validation, 429 limiter.

## Market data (`/api/market`, public, 120/min per IP for the whole router)

| Method | Path | Purpose |
|---|---|---|
| GET | `/market_chart/:id`, `/ohlc/:id` | CoinGecko proxies (`?days=`) |
| GET | `/futures/overview` | Top-40 perpetuals by 24h volume (mark, funding, OI USD), cached 10 s |
| GET | `/futures/symbols` | Tradable USDT perpetuals (pair picker), cached 5 min |
| GET | `/futures/klines/:symbol?interval=&limit=` | Candles (`1m,5m,15m,1h,4h,1d`, limit 1..1000), cached 10 s |
| GET | `/futures/stats/:symbol?period=` | OI, long/short, top-trader ratio, taker buy/sell, funding (`5m,15m,1h,4h`) |
| GET | `/futures/liqmap/:symbol` | Estimated liquidation levels (price buckets) |
| GET | `/futures/liqheat/:symbol?range=` | Estimated heatmap grid (`12h,24h,3d,1w`) |
| GET | `/futures/maxpain?window=&top=` | Pain field: strongest long level below / short level above price for the top N perps by volume (`window` as liqheat, `top` 1-30, default 20); 60 s cache + stale-while-revalidate, 10 req/min per IP, `skipped` counts coins left out; touch estimate is volatility-based, not a forecast |
| GET | `/futures/cvd/:symbol?interval=` (or `range=6h,24h,3d,1w`) | Cumulative volume delta from real Binance taker volume: futures `candles` plus a `spot` series (Binance spot klines), interval `1m,5m,15m,30m,1h,4h,1d`, 30 s cache; each side is `available:false` with a reason when unreachable (nothing approximated) |
| GET | `/futures/cvd/:symbol/trades?min=` | Recent Binance futures aggTrades at or above `min` USD (`10000,50000,100000,500000,1000000`), taker side, plus taker buy/sell flow of the last 60 s, `windowMs`/`count`/`medianUsd` of the fetched tape and `perMin` (15 clock minutes of buy/sell USD at or above `min`) (5 s cache) |
| GET | `/futures/liquidations` | Cross-symbol summary of the in-memory buffer (cached 2 s) |
| GET | `/futures/liquidations/:symbol` | Buffered real liquidation events `{since, events}` |
| GET | `/stocks/quotes`, `/stocks/klines/:symbol?interval=&limit=` | Curated NSE stocks (Yahoo, unofficial, delayed, view only). Display symbols only (`RELIANCE`, `TMPV`); anything off the allow-list is 404/400. Intervals `1m,5m,15m,1h,1d`; `stale: true` when the last good answer is served; 502 when Yahoo is down |
| GET | `/instruments/quotes?category=`, `/instruments/klines/:symbol` | Same for all curated markets: `stock`, `index` (`NIFTY50`, `BANKNIFTY`, `NIFTYIT`), `commodity` (`GOLD`, `SILVER`, `CRUDEOIL`, `BRENT`), `currency` (`USDINR`, `EURINR`, `GBPINR`, `EURUSD`) |
| GET | `/orderflow/heatmap/:symbol`, `/orderflow/large/:symbol` | Order Book Heatmap and Large Orders (walls + large trades) from an in-process depth collector. The `large` answer also carries `levels` (up to 40 book levels >= 5x median with `mult`/`distPct`), `activeWalls` (tracked, with `upForMs`) and `wallEvents` (the same log as the heatmap). The heatmap answer also carries the latest book ladder (20 levels a side with cumulative), spread, depth and imbalance within `band` (0.5/1/2/5 %, the covered band is reported when the snapshot is narrower) with the value ~5 min ago, tracked walls (largest per side, distance, up-for) and a wall event log (appeared/pulled/filled, max 200), and up to 300 taker-trade bubbles; query `grid` (1/2/5/10/20 x the base bucket) and `band`. Any USDT perp in the futures list (404 `no_futures` otherwise), 503 `collector_busy` when 5 coins are already collected and none is idle >30 s; `status` `collecting`/`ok`/`thin`/`stale`/`unavailable`; extra limit 40/min per IP |
| GET | `/providers` | Health of each data source: name, capabilities, breaker state, listed-symbol count (no URLs or errors) |

## News headlines (`/api/news`, public, 60/min per IP)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/news?limit=30&category=all\|crypto\|india` | Headlines with a short summary and image (`{items:[{id,title,link,source,category,publishedAt,image,summary}], sources:[{name,category,ok,at}], stale?, disclaimer}`), from 3 crypto and 3 Indian-markets RSS feeds; limit 1..50; cached 10 min; `stale: true` when every source fails and an older answer is served (up to 24 h); 502 `News unavailable` otherwise. `X-Data-Source: rss`. Titles are text-only, links http(s) only. `summary` is plain text, snippet capped at 200 chars (`''` if none); `image` is a hotlinked, publisher-owned https URL or `null` (we never copy or proxy the bytes); no full text. Publisher terms for snippets and images are still to be checked manually. External headlines, not our analysis, not investment advice. |
| GET | `/api/news/:id` | One headline by its 12-hex `id`, looked up in the full merged cached list (not limited to 50 or a category): `{item:{id,title,link,source,category,publishedAt,image,summary}, disclaimer}`. 404 `{error:'not found'}` for an unknown or malformed id; 502 `News unavailable` when no data. Same 60/min limit and `X-Data-Source: rss`. |

Every futures response carries `X-Data-Source`: `binance-futures` (default), `ws`, `bybit`, `bitget`, `gate`, `mexc`, `spot`, `unavailable` or `yahoo`. Anything other than `binance-futures` is third-party or reduced data and the UI says so. `/futures/liqheat` adds `partial: true` when the history is shorter than the range (new listing). Third-party data is analytics only: fills, marks, liquidations, TP/SL and alerts use Binance prices only.

Symbols in `/api/market/*`, `/api/ai/*` and alerts are **full futures symbols** (`BTCUSDT`); trading routes use the **base ticker** (`BTC`).

## Orrery (`/api/orrery`, off unless `ORRERY_APP_SECRET` is set; 503 otherwise)

Public market data only, read-only. Details and env vars: README, "Using Trade from Orrery".

| Method | Path | Auth | Purpose | Limit |
|---|---|---|---|---|
| GET | `/.well-known/orrery-app.json` | no | Manifest (404 while unset) | none |
| POST | `/api/orrery/mcp` | Orrery HS256 Bearer | MCP JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`; notifications -> 202; GET -> 405 | 60/min per token subject, 600/min per IP |
| POST | `/api/orrery/sso` | `{token}` in body (60 s, single use) | Existing account -> `{success, token, user}` like login; else 404 `{code:'NO_ACCOUNT', email}` | 10/min per IP |

## AI (`/api/ai`, authenticated)

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | `{configured, model, provider}` |
| GET | `/brief/:symbol` | Structured market brief (cached 5 min) |
| POST | `/ask` | `{symbol, question (3..500 chars)}` -> `{answer}` |
| POST | `/alerts/parse` | `{text (3..300 chars)}` -> `{draft}` or 422 |
| PUT | `/keys/:provider` | `{apiKey}` (8..300 chars) -> `{provider, keySet, keyLast4}`; 20/min/user |
| DELETE | `/keys/:provider` | Remove the saved key |
| POST | `/test` | `{provider}` -> `{ok, provider, model, latencyMs, models?}` using the saved key/model/baseUrl; `models` (same shape as `/models`) is added when the provider's list call also works |
| POST | `/models` | `{provider, apiKey?, baseUrl?}` -> `{models: [{id, name, contextLength?, pricePerMTokIn?, pricePerMTokOut?, free?}]}`; a typed `apiKey` is used for this one call and never stored, otherwise the saved key and saved base URL are used; 10/min/user; errors `ai_no_key`, `ai_auth_failed`, `ai_rate_limited`, `ai_unreachable`, `ai_bad_response` |
| GET | `/lmstudio/models` | `{models: [id]}`: chat models loaded in the user's LM Studio (saved base URL or default) |
| POST | `/agent/chat` | `{context: {kind: perp/instrument, symbol, page, interval?}, message (1..1000), conversationId?, wantStrategy?}` -> `{conversationId, reply, disclaimer}`. Single-shot analyst, no tools; it may return a strategy spec (inert JSON). A trade-intent message (trade, strategy, bot, go ahead, make $N...) runs in strategy mode even with `wantStrategy` off (`reply.strategyMode`: `on`/`auto`/`off`). `reply.structured` (verdict, headline, plan, levels, bull/bear/risks) is optional and server-checked; `reply.text` is always present. Nothing runs until the user accepts on the bot screen |
| GET | `/agent/conversations`, `/agent/conversations/:id` | Own conversations (max 10, 40 messages each, expire after 30 days) |
| DELETE | `/agent/conversations/:id`, `/agent/conversations` | Delete one / all own conversations |

AI-written code never executes. Strategies are a strict declarative JSON spec evaluated by the server.

## Strategies (`/api/strategies`, authenticated)

| Method | Path | Purpose | Limit |
|---|---|---|---|
| POST | `/validate` | `{spec}` -> `{spec, describe}` or 422 `invalid_spec` | 60/min/user |
| POST | `/evaluate` | `{spec` or `strategyId, kind: perp/instrument, symbol, limit?, costs?: {slippagePct}}` -> stats, trades, markers, series, caveats, `candlesSource`. The server fetches candles; client candles are rejected | 30/min/user |
| GET | `/`, `/:id` | Own strategies | none |
| POST | `/` | `{spec, name?, symbol?, origin?: ai/user}` (max 20, 409 `STRATEGY_LIMIT`) | none |
| PUT | `/:id` | Update `name`, `spec`, `symbol` | none |
| DELETE | `/:id` | Delete | none |

Backtest rules: signal on bar i fills at the open of bar i+1, stop is checked before target within a candle, fee 0.05% per side and slippage 0.02% by default, one position, fixed size, no compounding. Results are hypothetical and in-sample; the caveats are always returned.

Per user: 10 requests/min across brief/ask/parse/test/lmstudio models and agent chat; agent chat on the server's own key is also capped at 60/day. Process-wide hourly budget `AI_MAX_CALLS_PER_HOUR` applies only to the `default` provider. Error codes: `ai_no_key` 400, `ai_bad_base_url` 400, `ai_no_model` 400, `ai_local_disabled` 400 (LM Studio in production without `ALLOW_LOCAL_LLM`), `ai_key_unreadable` 409, `ai_rate_limited` 429, `ai_not_configured` 503, `ai_auth_failed` / `ai_unreachable` / `ai_upstream_error` / `ai_reasoning_budget` 502 (`ai_auth_failed` is 502 on purpose: the SPA signs out on any 401).

## Bots (`/api/bots`, authenticated, 30 writes/min/user)

| Method | Path | Purpose |
|---|---|---|
| GET | `/config` | Caps, defaults, allowed intervals and symbols, `botsEnabled`, disclosure text |
| GET | `/`, `/:id` | Own bots (each carries `acceptHash` and `accepted`); `/:id` adds today's counters |
| POST | `/` | Create from `{strategyId}` or `{spec}` plus `symbol`, `interval?`, `sizeUsd?`, `leverage?`, `limits?`, `name?`. Status `proposed`; returns the bot, plain-language description, `acceptHash`, worst-case loss and a backtest. Max 5 per user (409 `BOT_LIMIT`) |
| PUT | `/:id` | Edit `name`, `sizeUsd`, `leverage`, `limits` on a proposed or paused bot with no open position; resets it to `proposed` and voids any earlier acceptance |
| POST | `/:id/accept` | `{acceptHash, ack: true}`. Succeeds only if the hash matches the stored bot now; moves `proposed` to `paused` (409 `HASH_MISMATCH`) |
| POST | `/:id/decline` | Decline a proposed or paused bot |
| POST | `/:id/start` | Needs an accepted, unchanged bot and `BOTS_ENABLED` (403 `BOTS_DISABLED`); max 3 running per user (409 `RUNNING_LIMIT`) |
| POST | `/:id/pause`, `/:id/stop`, `/stop-all` | Flip status only; the engine closes any open position (protected by its SL/TP meanwhile) |
| GET | `/:id/decisions?limit=&kind=&before=` | Decision log (1..100): ticks, risk events, observed exits, lifecycle |
| GET | `/:id/performance` | Forward-only performance from settled positions versus buy-and-hold, with sample-size labels and backtest-versus-live drift |
| DELETE | `/:id` | Delete a bot that is not running and holds no position |

Bot limits: size $5 to $25,000, leverage 1x to 5x, daily loss limit (default $50), max trades per day (default 10), intervals `5m 15m 1h 4h 1d`, symbols from the top-40 perpetuals.

## Alerts (`/api/alerts`, authenticated, 60/min/user)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Own alerts with live `status` (`watching` / `no_data`) |
| GET | `/events?limit=` | Recent triggers (1..200, default 50) |
| POST | `/` | Create `{symbol, metric: price/funding/liq_usd_5m, op: above/below, value, note?, cooldownMin?}` (max 20 alerts, 5 symbols) |
| PATCH | `/:id` | Update `active`, `value`, `note`, `cooldownMin` |
| DELETE | `/:id` | Delete |

## Socket.IO namespaces

| Namespace | Auth | Client -> server | Server -> client |
|---|---|---|---|
| `/market` | none | none | `market:update` (top-20 CoinGecko list; snapshot on connect) |
| `/futures` | none | `futures:subscribe {symbol}`, `futures:unsubscribe {symbol}` (max 3 symbols per socket, 50 per server) | `futures:kline` (1m), `futures:mark`, `futures:book`, `futures:trades`, `futures:liquidation`, `futures:error` |
| `/alerts` | JWT in `handshake.auth.token` | none | `alert:triggered` to room `user:<id>` |
