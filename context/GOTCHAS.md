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

## Tests and tooling

| Gotcha | Detail |
|---|---|
| No supertest / no listening ports in tests | See `CONVENTIONS.md`; use the in-process dispatch pattern. |
| `react-router-dom` in jest | Needs `jest.mock('react-router-dom', factory, { virtual: true })`. |
| Axios ESM in jest | Importing `lib/api` (which imports axios) without a `jest.mock('axios')` fails with `Cannot use import statement outside a module`. Failing at 2026-11-20: `pages/Market.test.js`, `pages/Liquidation.test.js`, `components/trade/SymbolLiquidations.test.js`. |
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
