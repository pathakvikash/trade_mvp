# GOTCHAS (things that bit us or will)

## Environment and config

| Gotcha | Detail |
|---|---|
| `.env` is git-ignored and was overwritten once | `backend/.env` is in `backend/.gitignore` (`.env`, `.env.*`, keeps `.env.example`). It is not recoverable from git. Never overwrite it wholesale; edit single lines, and keep `backend/.env.example` current as the template. Do not read or print its contents in logs/chat. |
| Server will not start | In production also: `CORS_ORIGINS` required with no wildcard, `SEED_DEMO_USERS` not `true`. Joi requires `NODE_ENV` (`development|production|test`), `MONGO_URI`, `JWT_SECRET` (>= 32 chars, not placeholder-like: `change.me`, `secret...`, `example`, `xxxxxx`, `your secret`). The error lists keys/types, not values. |
| Set-but-empty vars | `PORT=` or `CORS_ORIGINS=` present and empty fail Joi validation (empty string is not a valid value); delete the line or give a value. The AI/Binance/poll vars are fine empty (`||` defaults). |
| Bind address | `HOST` defaults to `127.0.0.1` in development and `0.0.0.0` when `NODE_ENV=production`; `HOST` overrides. |
| Frontend env is build-time | CRA inlines `REACT_APP_*` when building/starting. After changing `REACT_APP_API_URL` restart `npm start` / rebuild + redeploy. Do not trail a `/`. `.env.production` holds a placeholder URL and is committed. |
| Sockets default to port 4000 | If `REACT_APP_API_URL` is empty, `lib/socket.js` connects to `<page origin with port replaced by :4000>`: wrong on any hosted domain. Always set the API URL for hosted builds. |
| `dev-hint` / Login card | Only in `NODE_ENV=development` + `SEED_DEMO_USERS=true` + 12+ char `DEMO_GUEST_PASSWORD` + loopback socket. Seeding **resets the guest password and role on every start** while on. `SEED_DEMO_USERS=true` with `NODE_ENV=production` fails startup (and `initializeDefaultUsers` also refuses). |
| Google button disabled | `GOOGLE_CLIENT_ID` missing on the **backend** (not frontend). Origin must be listed in Google "Authorized JavaScript origins" (exact scheme+host+port). |
| AI "not configured" | Needs `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`, or (development only) a logged-in `claude` CLI with no `ANTHROPIC_*` set and `AI_PROVIDER != api`. A set API key disables the CLI provider on purpose. The CLI probe result is cached 60 s. |
| Logs in production | Console transport is always on (JSON in production); `error.log`/`combined.log` only when `LOG_TO_FILES=true` (default off in production, on elsewhere). Redaction applies to both. |
| Log files by cwd | Winston writes `error.log`/`combined.log` relative to the process cwd (so `backend/` or wherever you started node, which is why stray logs appear in `backend/services/` and the repo root). |

| `ENCRYPTION_KEY` / `JWT_SECRET` rotation | Saved BYO AI keys become unreadable (`ai_key_unreadable` 409); users re-enter them. Unset `ENCRYPTION_KEY` logs one startup warning. An invalid value fails startup without printing it. |
| Google-created accounts | `passwordSet:false`; setting a password without the current one only works within 10 min of sign-in (`REAUTH_REQUIRED` otherwise). |

## Routes and servers

| Gotcha | Detail |
|---|---|
| **`/markets` vs `/market`** | Frontend page route is `/market` (`/markets` redirects to it); the backend router is `/api/market` (market data) and `/api/futures` (paper futures). Different things: `/api/market/futures/...` is Binance data, `/api/futures/...` is trading. |
| **Backend must be restarted to pick up routes** | `npm start` is plain `node server.js` (no nodemon/watch). New/changed routes, controllers, services, env vars need a restart. A 404 on a route that exists in the code usually means a stale process. |
| Port 4000 occupied | A stale backend still answers on 4000 with old code. Sandboxed shells cannot see other processes (`lsof` silently shows nothing); check from a normal terminal. |
| Two engines | Never run two backend processes against the same MongoDB: two risk engines race ledger recovery and can roll back an op mid-flight; two matchers double-poll. Deploys must be stop-then-start. |
| `TRUST_PROXY` | Default `0`: `req.ip` is the socket peer, so behind Render/Railway/Fly all clients share one per-IP limit bucket. Set `TRUST_PROXY=1` (hop count) there. `true` trusts all `X-Forwarded-For` entries (spoofable). Socket.IO has no IP-keyed limits. |
| Health check | `GET /api/health` (public) returns 200 `{ok, uptime, mongo:'up' or 'down'}` even when Mongo is down (liveness, not readiness). |
| Limits you will trip while testing | login 10/min per IP, register 5/hour per IP, trades 30/min per user, futures writes 30/min per user, AI 10/min per user (+60/h process), alerts 60/min. 429 body `{error:'rate_limited'}` + `Retry-After`. Counters reset on restart (in memory). |
| CORS | Origin list is exact-match (`CORS_ORIGINS`), applies to REST and sockets. `localhost:3000` vs `127.0.0.1:3000` are different origins. |

## Market data

| Gotcha | Detail |
|---|---|
| **Binance feed may be unavailable in a sandbox / region** | No network in a sandbox, or Binance HTTP 451 (blocked region, many US hosts): `overview`, klines, liquidations, marks and therefore **every market order** (`503 No price available`) fail. REST routes answer 502 with `Binance blocks this server's region (HTTP 451)`. UI shows retry states. Test against fakes, not live Binance (`futuresRest`/`futuresService` are mocked in tests). |
| **Binance REST IP-blocked (Render: 418/403/451/429)** | `futuresRest.get` has a circuit breaker: a block opens it for max(300 s, Retry-After) (429: Retry-After or 60 s), then one probe goes out; only the probe closes it. Fallbacks, only when REST fails: overview rows from the `!miniTicker@arr` + `!markPrice@arr` WS streams (no OI; `ts` = mark receive time), klines from the spot mirror `data-api.binance.vision` (`BINANCE_SPOT_REST`; perp-only symbol -> `[]`, source `unavailable`), symbol list from ticker keys, `markPrice` from the WS mark, stats all-empty + `degraded:true`. liqmap/liqheat have no alternative: 503 `degraded`. REST is always tried first; responses carry `X-Data-Source` (`ws`/`spot`/`unavailable`, default `binance-futures`). Spot candles differ slightly from futures candles. **Bybit v5 public REST (`BYBIT_REST`)** is tried after Binance fails (`fallbackable`) and before the spot mirror: klines (`bybit`, real perp candles), stats (OI x candle close, account ratio, funding; top-trader/taker `[]`, body `source:'bybit'`), liqmap/liqheat inputs (tagged `bybit`; Bybit failure rethrows the Binance error, so still 503), overview OI from the tickers call (rows stay `ws`). Bybit has a small breaker (no response/403/418/429/451/5xx skips it 5 min, then one probe; 4 s timeout, 8 s cap per liq/stats call), unknown symbol (retCode 10001) = empty, and OI uses `singleOpenInterest*` (Bybit's `openInterest*` is both sides, 2x). The overview never waits on Bybit: OI is null until the background tickers refresh lands. Bybit OI/ratios are not Binance's; the UI labels them. |
| **Gateway fallbacks (`services/marketData/`)** | The Bybit text in the row above is now one link in a chain: klines binance>bybit>bitget>gate>mexc>spot, oiHist binance>bybit>gate, ratio binance>bybit>gate>bitget, topRatio/taker binance>gate, funding binance>bybit>bitget>gate>mexc. Each host has its own breaker (third parties also open on no-response/5xx for 5 min, then one probe); a provider that does not list the symbol (registry, cached 1 h) is skipped with no request; rows are cleaned and stale/empty answers move on. `X-Data-Source` values: `binance-futures` (default), `ws`, `bybit`, `bitget`, `gate`, `mexc`, `spot`, `unavailable`, `yahoo`. Gate and MEXC contract sizes are converted to base coin with the listed multiplier (never guessed as 1; without a mult, Gate klines/taker return `[]` and oiHist omits `oi`; MEXC needs it the same way for klines). Numbers differ between exchanges: the UI labels them (`sourceNote.js`). `GET /api/market/providers` shows breaker state; if a provider looks dead, check there before the logs. |
| **Order flow collector** | `services/orderflow/collector.js` is in memory and per process: restart = empty. A symbol is sampled only while a client keeps requesting it (idle 5 min drops it and its data, so 'N min so far' restarts), max 5 symbols at once (a 6th evicts the least recently requested one if quiet >30 s, else 503 `collector_busy`), any symbol `futuresRest.isKnownSymbol` accepts (else 404 `no_futures`; the check is in the route, the collector trusts it), thin books (<5 levels a side or spread >2%) answer `status: thin` with no grid. 600/min at the cap is now 1000/min. Cost on Binance: depth limit 500 every 5 s (weight 10) + aggTrades every 15 s (weight 20) = about 200 weight/min per symbol, 600/min at the cap, so it shares the IP budget with the rest of the app; a block opens the Binance breaker and the collector moves to Bybit (matrix cleared). REST snapshots only cover the levels one call returns (about +-0.05% around BTC, wider on alts) and miss changes between snapshots. Tests inject fakes via `createCollector`; never call the singleton's network fetchers in tests. |
| `partial` history | `liqheat` returns `partial: true` when the provider has fewer candles than the range asks for (new listing); the UI shows `PARTIAL_NOTE`. Not an error. |
| News feeds can block datacenter IPs | `services/news.js` fetches 6 RSS feeds with the honest `Paperline/1.0` UA (never a browser UA). A 403/429 or no response opens that source's own breaker for 5 min; the others keep serving and `sources[].ok` says which failed. All failed: last merged answer with `stale:true` (<= 24 h), else 502. Items also carry `image` (hotlinked, publisher-owned https URL) and `summary` (snippet capped at 200 chars); terms for both still to be checked manually. Headlines and summaries never go into AI prompts (injection). Feeds were only verified from a laptop, not from Render. |
| Yahoo is unofficial | `providers/yahoo.js` needs an explicit `User-Agent` (curl's default gets 429); `/v7/finance/quote` is unauthorized upstream and not used; 4h is unsupported (intervals `1m,5m,15m,1h,1d`). NSE quotes lag ~15 min. Failures serve the last good answer with `stale: true` for up to 24 h, then 502. `TATAMOTORS.NS` is delisted after the demerger: use `TMPV` / `TMCV`. Instruments are an allow-list: a new market means editing `instruments.js` and checking its Yahoo ticker live. Closed markets reuse the last quote for 15 min. |
| Backtest is not a promise | `/api/strategies/evaluate` drops the still-forming candle, fills at the next open, assumes stop before target in one candle, and runs in-sample on at most 1000 candles; the caveats are always returned and the UI must show them. Perp candles may come from spot or another exchange (`candlesSource`). |
| Agent limits | 429 comes from three places: 10/min per user (shared with brief/ask/alerts-parse), 60/day on the `default` provider, and the process hourly budget. Conversations: 11th evicts the oldest; messages past 40 drop the oldest; all expire 30 days after the last message. Strategies: 409 `STRATEGY_LIMIT` at 20. |
| LM Studio on a hosted server | Does not work: the deployed backend cannot reach a user's `localhost`. Keep `ALLOW_LOCAL_LLM` unset in production. |
| OpenRouter model ids | Dots, not hyphens (`anthropic/claude-sonnet-5.5`); a saved `anthropic/claude-sonnet-5-5` is rewritten to the dot form before the call. |
| Keepalive and Render | `keepalive.yml` pings `https://cryptozen-api.onrender.com/api/health` every 5 min so the free instance does not sleep (sleep pauses the engines). GitHub cron can lag 5-15 min and disables itself after 60 days of repo inactivity: re-enable it in the Actions tab or use cron-job.org. |
| exchangeInfo failure | If `/fapi/v1/exchangeInfo` never loads, symbol checks fall back to regex only (any `XXXXUSDT` passes); a failed refresh keeps the last good set and retries after 1 min. |
| Liquidation data is partial | Exchange stream is throttled (<= 1 event/s/symbol); buffer starts at server boot (plus <= 24 h reloaded from Mongo). Map/heatmap are estimates. Overview lists only the top 40 perps by volume, so `openInterestUsd` can be `null` on a cold start (OI calls get 3 s). |
| Mark vs last price | Fills use the **mark**; the chart shows futures last/candle close. Small differences are normal. PnL in `PositionsTable` uses the overview price when the live mark is missing and shows `--` outside the top 40. |
| CoinGecko | Markets page and `/api/market/market_chart|ohlc` use the free public API: rate limited (429) upstream; failures surface as 502/empty list. |
| Mark streams need a hold | A symbol has a server-side mark only while someone subscribed, an alert holds it, or the risk engine holds it for open positions/orders. Global cap 50 symbols; `hold` returns false past it (alerts then show `no_data`). |

## Money and engines

| Gotcha | Detail |
|---|---|
| Symbol formats | Trading uses `BTC`; market data/AI/alerts use `BTCUSDT`. Mixing them gives 400/404 or an Unknown market. |
| Don't edit balances directly | Futures money must go through `futuresLedger.run`; spot through `executeFill`/conditional updates. A direct `balance` write breaks exactly-once and the reservation accounting. |
| Locked positions | `lockOp != null` means an op is mutating it. API calls get 409 `POSITION_BUSY`; the engine ignores it. An `error` op leaves targets locked until a human fixes it (look for `FUTURES OP ERROR` in logs). |
| Declare new User fields in the schema | Mongoose strict mode silently drops `$set` of undeclared paths (that is why `futuresOps` is in `User.js`). |
| `docs/phase2-leverage.md` vs code | Code adds `Position.rev`, lock `expect` filters, `OP_FAILED`, `BAD_SIZE`, periodic marker sweep. Trust the code. |
| Float noise | Never compare money floats with `===`; use the cents helpers. |
| Liquidation has no fee and credit 0 | Entire margin is forfeited; `realizedPnl` records `-margin`. |
| Account delete races | Deleting a user mid spot limit fill leaves the order rejected with noisy refund/orphan logs (no money). A futures request that passed auth just before the lock can orphan one op/position (parks as an `error` op). |
| `ai_auth_failed` is 502 | On purpose: the SPA signs out on any 401, so a bad provider key must not be 401. |

## Tests and tooling

| Gotcha | Detail |
|---|---|
| No supertest / no listening ports in tests | See `CONVENTIONS.md`; use the in-process dispatch pattern. |
| `react-router-dom` in jest | Needs `jest.mock('react-router-dom', factory, { virtual: true })`. |
| Axios ESM in jest | Importing `lib/api` (which imports axios) without a `jest.mock('axios')` fails with `Cannot use import statement outside a module`. The three suites that failed on this at 2026-11-20 (`pages/Market.test.js`, `pages/Liquidation.test.js`, `components/trade/SymbolLiquidations.test.js`) pass now (2026-11-21); keep the mock in any new test touching `lib/api`. |
| CI = warnings are errors | `CI=true npm run build` fails on ESLint warnings. |
| npm cache | Sandbox may need `npm install --cache "$TMPDIR/npm-cache"`. |
| Jest watch mode | CRA `npm test` is interactive; use `CI=true ... --watchAll=false` in scripts/agents. |
| Other agents edit the tree | Several agents may modify files concurrently; re-read before editing, never revert unrelated changes. `git status` shows a large uncommitted set. |

## UI

| Gotcha | Detail |
|---|---|
| Page scroll at `xl` | Missing `min-h-0`/`min-w-0` on a flex/grid child makes the Trade page scroll. See layout rules in `CONVENTIONS.md`. |
| Persisted state per user | `usePersistedState` keys include the user id; a logged-out value is `anon`. Stored values are validated; bump the `validate` rule, not the key, when shapes change. |
| `OrderCard` is keyed by symbol | Changing symbol remounts the forms (intentional reset). |
| Legacy files | `CompanyDash.jsx`, `components/company/*`, `CompanyViewModel.js`, `CompDash.css` are unused; do not copy patterns from them. Default CRA title in `public/index.html`. |
| LM Studio context | LM Studio loads models with a small context (8192 for qwen3.5-9b) whatever the model supports, and parallel requests split it. The full brief data block is ~12k tokens, so `aiService.compactLocal` trims it for `lmstudio` (newest 6 rows, no timestamps, 5 liq levels; ~2.7k tokens). An overflow returns `502 ai_context_too_small`; any other LM Studio error returns `ai_upstream_error` with a `detail` (200 chars). Every upstream non-2xx is logged at warn (provider, status, 300 chars, key masked). Thinking is off by default (`LMSTUDIO_REASONING_EFFORT`), timeout 180 s. |
