# ARCHITECTURE

One repo, two apps. **Backend** = a single long-running Node process (HTTP API + Socket.IO + background engines). **Frontend** = a static React SPA that polls REST and listens to sockets. MongoDB holds all durable state; live market data is in memory.

```
Browser (React SPA)
  |-- REST (axios, Bearer JWT) --> Express routes -> controllers -> services/models -> MongoDB
  |-- Socket.IO /market /futures /alerts
Backend process (backend/server.js) starts, in this order:
  Express app + routes, mongoose.connect (then lockLegacyAccounts, seed demo guest, warnAboutAdmins),
  HTTP server + Socket.IO, marketService (CoinGecko 30s), futuresService (Binance WS), alertService (5s),
  orderMatcher (2s), riskEngine (1s). SIGINT/SIGTERM: stop all, wait <= 5s for in-flight settles, exit.
```

## Backend module map (`backend/`)

| Path | Responsibility |
|---|---|
| `server.js` | Wiring: middleware order (helmet, json 100kb, cors, morgan), route mounts, Mongo connect, Socket.IO namespaces, engine start/stop, `HOST` default `127.0.0.1`. `trust proxy` deliberately NOT set. No health route. |
| `config/config.js` | Joi-validated env (`NODE_ENV`, `PORT`, `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGINS`); throws on bad config without echoing values. Other env vars are read directly with `process.env` in the files that use them. |
| `config/logger.js` | winston; redacts `authorization/password/token/secret/cookie` keys; files only (`error.log`, `combined.log`) + console unless production/test. Silent under jest. |
| `routes/authRoutes.js` | `/api/auth/*` with per-IP limiters, validators, `DEV ONLY` `dev-hint`. |
| `routes/tradeRoutes.js`, `orderRoutes.js` | Spot: place/list trades, portfolio; list/cancel limit orders. |
| `routes/futuresRoutes.js` | Futures API (auth on all, 30/min/user writes). |
| `routes/marketRoutes.js` | Public market data: CoinGecko proxies + Binance futures REST aggregations + liquidation buffer; 120/min/IP. |
| `routes/aiRoutes.js` | `/api/ai/*`: status, brief (5 min cache), ask, alerts/parse; per-user 10/min + process budget. |
| `routes/alertRoutes.js` | Alerts CRUD + events (inline validation, 60/min/user). |
| `controllers/authController.js` | register, login, Google login, verify, me, updateMe, changePassword, `devHint`, `authConfig`, boot-time `lockLegacyAccounts` / `initializeDefaultUsers` / `warnAboutAdmins`. JWT `sign()` (HS256, 24h). |
| `controllers/tradeController.js` | Spot market + limit placement, portfolio (holdings + avg cost), trade list. |
| `controllers/orderController.js` | List/cancel spot limit orders (conditional status flip, then release reservation). |
| `controllers/futuresController.js` | Futures API: validates, quotes via `futuresMath`, builds ledger op specs, maps ledger results to HTTP (`ApiError` + codes). Never writes money itself. |
| `controllers/BaseController.js` | `wrap(handler)` async error wrapper + response helpers. |
| `middleware/auth.js` | Bearer JWT verify (HS256 only) + `accountOk` (user exists, not `lockedAt`, token `iat` >= `passwordChangedAt`). Exports `accountOk` (also used by the alerts socket). |
| `middleware/rateLimit.js` | In-memory sliding-window limiter: `createLimiter`, `limitBy(opts, keyFn)`, `ipKey` (IPv6 -> /64). Max 5000 keys, LRU eviction. |
| `middleware/validator.js` | express-validator rule sets (auth, settings, spot extras, futures order/close/tpsl) + `validate` (422). |
| `middleware/errorHandler.js` | Generic JSON error; logs full error server-side, never to the client. |
| `models/*.js` | `User`, `Trade`, `Order`, `Position`, `FuturesOrder`, `FuturesOp`, `Alert`, `AlertEvent` (TTL 30d), `Liquidation` (TTL 2d). See `../README.md` for fields. |
| `services/tradeMath.js` | Pure spot money math (cents): fee 0.1%, `quote`, `avgCost`, `notionalCents`, `round8`, `MIN_NOTIONAL_CENTS`. |
| `services/tradeFill.js` | **`fillPrice`** (the only fill price source), `ensureHoldings` (lazy holdings migration from Trade history), `executeFill` (one conditional update + Trade insert + reversal), `releaseReservation`, `holdKey`, `SYMBOL_RE`. |
| `services/orderMatcher.js` | 2 s loop filling spot limit orders at the limit price; claim by `open -> filled`; retry/refund rules; orphan sweep at start. |
| `services/futuresMath.js` | Pure futures money math (cents): fee 0.05%, tiers, `openQuote`, `addQuote`, `closeQuote`, `liqPrice`, `unrealized`, `maxLeverage`. |
| `services/futuresLedger.js` | **Exactly-once executor** for every futures money/position change: `run(spec)`, `recover(op)`, `recoverAll()`. |
| `services/riskEngine.js` | 1 s loop: recovery of aged pending ops, liquidation > SL > TP per open position, limit-entry fills; all via `ledger.run`. |
| `services/futuresService.js` | Binance WS (two connections: `public` depth, `market` kline/markPrice/aggTrade/forceOrder), marks map, ref-counted `hold/release`, liquidation buffer (memory + Mongo), room fan-out on the `/futures` namespace. |
| `services/futuresRest.js` | Cached Binance REST: exchangeInfo symbol set (`isKnownSymbol`, `listSymbols`), overview (top 40), stats, liqmap, liqheat, klines, single `markPrice`. |
| `services/futuresUtils.js` | Pure helpers: symbol regex (`^[A-Z0-9]{2,20}USDT$`), normalisers, liquidation summary, **liquidation estimation models** (`estimateLiqLevels`, `estimateLiqHeat`, `liqKeyLevels`). |
| `services/marketService.js` | CoinGecko top-20 poller -> `/market` namespace (`market:update`). |
| `services/alertService.js` | 5 s evaluator, 60 s refresh of active alerts, holds mark streams for alert symbols, `/alerts` socket (JWT auth) -> `alert:triggered`. |
| `services/aiService.js` | Claude calls: `brief`, `ask`, `parseAlert`, provider selection (API vs dev CLI), model allow-list, hourly budget, error mapping, context building from market data. |
| `tests/` | One file per concern: `trade`, `limit-orders`, `tradeConcurrency`, `tradeMath`, `futures{Math,Models,Ledger,Api,Rest,Service,Utils}`, `riskEngine`, `alerts`, `ai`, `ai-cli`, `auth`, `google`, `jwt`, `settings`, `hardening`, `marketRoutes`; `setupEnv.js` sets dummy env. |

## Frontend module map (`frontend/src/`)

| Path | Responsibility |
|---|---|
| `index.js`, `App.js` | Mount, `installAuthInterceptor()`, router (lazy pages; public: `/`, `/login`, `/register`, `/market` (`/markets` redirects); protected: `/dashboard /trade /derivatives /portfolio /liquidation /settings`; `/alerts` redirects to `/trade?alerts=1`; `*` -> NotFound behind `ProtectedRoute`). Starts the market socket once. |
| `components/Layout.js`, `Header.jsx`, `Sidebar.js`, `shell/nav.jsx`, `shell/CommandPalette.jsx` | App shell (collapsible sidebar, command palette, nav source of truth), one authed alerts socket while logged in. |
| `components/ProtectedRoute.js`, `ErrorBoundary.js` | Route guard (verifies the persisted token once), render-error boundary per page. |
| `pages/` | `Home`, `Login`, `register`, `Market`, `Dashboard`, `Trade`, `Derivatives`, `Liquidation`, `Portfolio`, `Settings`, `NotFound` (+ tests for Market, Liquidation, Portfolio, Settings). |
| `components/trade/` | Trade workspace: `SymbolHeader`, `SymbolCombobox`, `MarketChartPanel`, `CandleChart` (lightweight-charts), `candleSync`, `OrderBookPanel`, `TradesTapePanel`, `MarketStatsPanel`, `KeyStats`, `SymbolLiquidations`, `OrderCard` (Spot/Futures switch), `TradeForm` (spot), `FuturesForm`, `LeverageControl`, `TpSlFields`, `BottomStrip` (Positions / Open orders / History / AI Copilot), `PositionsTable`, `SpotHoldings`, `FuturesHistory`. |
| `components/liquidation/` | `LiqHeatmap`, `LiqHeat`, `LiqMap`, `LiqSide`, `CoinTreemap` + `treemap.js`, `Summary`, `LiveFeed`, canvas helpers (`useCanvas`, `heat.js`, `bucket.js`), `shared.js` (`FUT` base URL, `coin()`, formatters). |
| `components/derivatives/` | `MarketTable`, `FundingStrip`, `StatChart`, `signals.js`. |
| `components/dashboard/` | `Tiles`, `Tile`, `Panels`, `Sparkline`, `Bars`, `stats.js`, `format.js`. |
| `components/market/` | `MarketList`, `MarketChart` (CoinGecko-based Markets page). |
| `components/ai/CopilotPanel.jsx` | Brief/Ask UI, `useAiConfigured` (reads `/api/ai/status`), error mapping. |
| `components/alerts/` | `AlertsPanel` (list/create/AI draft), `Toasts`, `alertLogic.js`. |
| `components/auth/GoogleButton.jsx` | Loads Google Identity script, posts credential to `/api/auth/google`. |
| `components/ui/` | Kit: `Panel`, `Card`, `Button`, `Input`, `Select`, `SegTabs`, `Skeleton`, `Spinner`, `PairPicker`, `fmt.js`, `pairs.js`. |
| `store/` | zustand: `userStore` (persisted `user-storage`: token, user), `marketStore` (market socket), `futuresStore` (symbol-scoped candles/book/mark/trades/liquidations over the futures socket), `alertStore` (alerts, events, toasts, alerts socket). |
| `lib/` | `api.js` (`API`, `authed`, `errText`, 401 interceptor, `verifySession`), `socket.js` (one socket per namespace), `usePolling` (pauses when tab hidden), `usePersistedState`, `usePortfolio`, `useFutures` (3 s polling of positions/orders + config), `futuresMath.js` (client mirror for previews), `chartLines.js`. |
| Legacy, unused | `CompanyDash.jsx`, `CompanyDash`-chain `components/company/*`, `CompDash.css`, `components/CompanyViewModel.js`. `CandlestickChart.js` and `pages/Alerts.js` were deleted in the working tree. `components/LiquidationHeatmap.js` is still used by `pages/Liquidation.js`. |

## Request lifecycles

### 1. Spot market order  (`POST /api/trades`)

1. `routes/tradeRoutes.js`: `auth` (JWT + `accountOk`) -> `limitBy` 30/min/user -> `placeTradeRules` -> `placeTrade`.
2. `tradeController.placeTrade` validates `type`, `cryptoSymbol` (`^[A-Z0-9]{2,20}$`), `amount` (finite, >0, <=1e9, round8), `orderType`; checks `futuresRest.isKnownSymbol(`${sym}USDT`)`.
3. `tradeFill.fillPrice('BTCUSDT')`: websocket mark <= 3 s old, else REST `premiumIndex` <= 10 s, else overview row, else `null` -> **503**.
4. `tradeMath.quote` -> notional/fee/total in cents; < $5 -> 400. `ensureHoldings` lazily builds `holdings` from Trade history once.
5. `executeFill`: ONE `User.findOneAndUpdate` conditional on funds/holding that `$inc`s `balance` and `holdings.<SYM>` together; then `Trade.create`. If the insert fails the `$inc` is reversed (log `COMPENSATION FAILED` if even that fails).
6. 201 `{fill:{price, priceAgeMs, fee, total}, balance}`.

### 2. Spot limit order + matcher

1. Same entry; `orderType:'limit'` -> `placeLimit`: min notional, max 20 open orders, then a conditional `$inc` **reserves** funds (buy: `total` USD incl. fee; sell: the coins), then `Order.create` (compensates the reserve if it fails). 201 `{order, balance}`.
2. `orderMatcher` (every 2 s, one in-flight pass): loads open orders (<=1000, oldest first), groups by symbol, `fillPrice` per symbol (no fresh price -> skip), `crosses` (buy: mark <= limit; sell: mark >= limit).
3. `fillOrder`: claim with `findOneAndUpdate({status:'open'} -> 'filled', fillPrice = limit)`; `executeFill` with `reserved` (unconditional update: buy refunds reserved - total and adds coins; sell credits total); links `Trade.orderId`.
4. Failure: clean failure reopens the order (`failures++`; 3rd failure -> `rejected` + refund); `compensationFailed` parks it as `error` for manual review. Startup `sweepOrphans` logs filled orders with no Trade.
5. Cancel (`DELETE /api/orders/:id`): conditional `open -> cancelled`; only the winner calls `releaseReservation`; if release throws the order is put back to `open`.

### 3. Futures open / add / close through the ledger  (`/api/futures`)

1. `auth` -> `writeLimit` (30/min/user) -> `futuresOrderRules` (strict types, unknown keys 422) -> `futuresController.placeOrder` (isKnownSymbol; round8 size).
2. **Market**: `markNow` (`fillPrice`; 503 `NO_PRICE`). If the user has an open position on symbol+side -> `addSpec` (same leverage else 409 `LEVERAGE_MISMATCH`; tier cap on combined notional; TP/SL bounds), else `openQuote` + min notional + `checkLeverage` + `checkTpsl` + max 20 positions. Builds an op spec: `deltaCents` (= -debit), `targets` (new Position with `status:'opening'` and `activeKey`, or an existing Position with `expect:{status,size,rev}`), `post` (frozen final state).
3. **Limit**: `placeLimit` -> op `place` creating a `FuturesOrder` (`placing` -> `open`), debit = margin + fee at the limit price (the reservation).
4. `futuresLedger.run(spec)`, steps: (1) `FuturesOp` journal row `pending` with frozen numbers; (2) lock each target (`lockOp = op._id`; E11000 on `activeKey` -> `onDuplicate` rebuilds as an add, once); (3) one conditional `User.updateOne` that `$inc`s `balance` and sets marker `futuresOps.<opId>` (guard `balance >= debit`); (4) apply `post` to each target and `$inc rev`; (5) op `done`; (6) clear marker. Failure to lock -> `rolled_back` / `POSITION_BUSY`; insufficient funds -> rolled back, new docs voided -> 400 `INSUFFICIENT_BALANCE`.
5. **Close** (`POST /positions/:id/close {size?}`): own position, open and unlocked; `closeQuote` at the mark (pnl floor, fee ceil, credit = max(0, released + pnl - fee)); partial must leave >= $5 notional; op `close` with `deltaCents = +credit`; final close sets `status:'closed'`, unsets `activeKey`.
6. **TP/SL edit** (`PATCH /positions/:id`): no money moves, so no ledger op; one conditional `findOneAndUpdate` (`status:'open', lockOp:null`, `$inc rev`).
7. Responses map ledger codes: `POSITION_BUSY|DUPLICATE_ACTIVE|INCOMPLETE_LOCK` -> 409 `POSITION_BUSY` (retry); unknown -> 500 `OP_FAILED`.
8. Crash recovery: `recover(op)` rolls an op **forward** from the journal (see `DOMAIN.md`); `riskEngine` calls `recoverAll` at start (all pending older than 15 s) and every pass (<=50, older than 15 s). After 10 failed attempts an op becomes `error` and its targets stay locked ("under review").

### 4. Liquidation / SL / TP / limit fill by the risk engine

`riskEngine` runs every 1 s (skips unless Mongo `readyState === 1`; one pass in flight):
1. `recoverAll` (aged pending ops; marker sweep at start and every 5 min).
2. Load a page of `Position{status:'open', lockOp:null}` and `FuturesOrder{status:'open', lockOp:null}` (<=2000 each, `_id` cursor rotation), group by symbol, reconcile `futuresService.hold/release` so each symbol's mark stream is subscribed.
3. Per symbol: `fillPrice` (none -> skip; never acts on a stale mark).
4. Per position, first match wins: **liquidate** (long: mark <= liqPrice; short: mark >= liqPrice; credit 0, no fee), else **sl**, else **tp** (market close of the whole position at mark). Each is one `ledger.run`; the lock is the claim, so a user close racing a trigger settles once (loser gets `POSITION_BUSY`).
5. Per crossed limit order (long: mark <= limit; short: mark >= limit): `fillSpec` opens or adds at the **limit price** (delta = reserved - debit, normally 0); leverage mismatch or tier overflow rejects the order and refunds the reservation.
6. The UI learns about it by its 3 s polling of `/api/futures/positions` (no push).

### 5. AI brief  (`GET /api/ai/brief/:symbol`)

1. `auth` -> `isValidSymbol` (`BTCUSDT` form) -> `isKnownSymbol` (404 if not a perp) -> per-user limiter (10/min, after validation).
2. Cache key `symbol|model` (5 min; in-flight promise shared; failures evicted). Model = user's `ai.model` if on the allow-list else `AI_MODEL`/`claude-opus-5-5`.
3. `aiService.brief`: `gather` (overview row, 1h stats, liq map, 48 x 1h candles, sampled liquidation buffer; each upstream may fail independently, all failing -> 502 `market_data_unavailable`) -> `spendOrThrow` (hourly process budget, 429) -> `structured()`.
4. `structured()`: dev CLI provider when `cliAvailable()` (schema in the system prompt, JSON parsed + zod, one retry) else Anthropic SDK `beta.messages.create` with `output_config.format` (zod) and cached system prompt.
5. Errors mapped by `mapError` to `{error: code}` with 429/422/502/503; SDK messages are never returned.

### 6. Alert trigger

1. User creates an alert (`POST /api/alerts`, validated; <=20 alerts, <=5 symbols) or accepts an AI draft from `/api/ai/alerts/parse`; `alertService.refresh()` reloads active alerts.
2. `alertService.reconcile` holds the mark stream of each `price`/`funding` alert symbol (`liq_usd_5m` reads the all-market liquidation buffer).
3. Every 5 s `evaluate`: observe (mark price, funding as percent, or sum of liquidation USD in 5 min; marks older than 30 s count as missing), `shouldTrigger` (active, 60 s hard floor, cooldown, strict `>`/`<`).
4. On trigger: emit `alert:triggered` to room `user:<id>` on `/alerts`, update `lastTriggeredAt`, insert `AlertEvent` (TTL 30 d).
5. Browser: `alertStore.connect(token)` (own socket manager) -> toast (+ optional beep per `preferences`), unread badge.

### 7. Login and JWT

1. `POST /api/auth/login` (10/min/IP, validators): lookup by lowercased email, bcrypt compare (dummy hash if unknown), reject locked; `sign()` = HS256, 24 h, payload `{userId, role}`. Response `{token, user}` (public fields only).
2. Client: `userStore.setLogin` persists `{token, user}` in localStorage `user-storage`. All calls use `Authorization: Bearer`.
3. Server per request: `middleware/auth` verifies signature (HS256 only), then `accountOk` (DB read): user exists, not locked, `iat >= passwordChangedAt`. Else 401 `Invalid token`.
4. Client: `ProtectedRoute` verifies the token once per page load via `GET /api/auth/verify`; the axios response interceptor logs out and redirects to `/login` on any 401 from our API (except login/register/password endpoints, unless the body says the session is dead).
5. Password change: new hash, `passwordChangedAt = now` (kills all older tokens), returns a fresh token. Google login: client posts the Google ID token -> `verifyIdToken` against `GOOGLE_CLIENT_ID`, `email_verified` required -> same `sign()`.
6. Sockets: `/market` and `/futures` are public; `/alerts` verifies the same JWT + `accountOk` in the handshake.

## Cross-cutting facts

- **Symbol formats**: trading routes + DB (`Order.symbol`, `Position.symbol`, holdings keys) use the base ticker `BTC`; market data, sockets, AI, alerts use `BTCUSDT`. Convert with `${base}USDT` / `replace(/USDT$/, '')` (frontend: `coin()` in `components/liquidation/shared.js`).
- **Polling vs push**: futures positions/orders poll every 3 s, spot open orders every 5 s, overview 15 s (all paused when the tab is hidden); portfolio is fetched on mount and after each order via `reload()`; market data uses sockets; liquidation/TP/SL events are not pushed.
- **Background engines live in the API process** (see `DECISIONS.md`: single process).
