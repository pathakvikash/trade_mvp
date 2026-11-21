# CONVENTIONS

## General

- Plain JavaScript everywhere (no TypeScript). Backend is **CommonJS** (`require`), frontend is ES modules (CRA).
- Small, boring, readable. No new abstraction for a single use, no new dependency for something a few lines or the platform does. Prefer extending an existing helper (`tradeFill`, `futuresUtils`, `components/ui/*`, `lib/*`) over writing a parallel one.
- Comments explain **why** and invariants (money, concurrency), not what. Known ceilings are marked `// ponytail: <limit>, <upgrade path>` (for example the in-memory limiter, count-then-insert caps). Keep that marker when you leave a deliberate shortcut.
- Indentation is mixed across files (2 or 4 spaces); match the file you edit. No formatter config is checked in.
- Never put secrets or personal data in code, logs, URLs, or tests. `.env` is git-ignored; examples go in `.env.example` with empty values.
- Docs: no line numbers in docs (they rot); reference file paths and names.

## Backend

| Topic | Convention |
|---|---|
| Handlers | Wrap with `BaseController.wrap`; return `{ success, message }` on failure. Futures throws `ApiError(status, code, message)` through `handle()`; alerts/AI/market use `{ error }`. |
| Validation | express-validator rule sets in `middleware/validator.js` for body shape (strict types: `isString()` first so `{"$gt":""}` never reaches Mongo; unknown keys rejected with `plainObjectWithKeys`), controller checks for business rules. `:id` params: 24-hex regex + `mongoose.isValidObjectId`, else 404. |
| Auth | `router.use(auth)` first; user id comes **only** from the JWT (`userIdOf(req)`), never from the body. Other users' resources look like missing ones (404). |
| Rate limits | `limitBy({limit, windowMs}, keyFn)` per route; per-IP before auth for credential routes, per-user (`req.user.userId`) after `auth` for the rest. AI uses `createLimiter` after input validation so bad input does not burn quota. |
| Money | Integer cents in engines (`DOMAIN.md`). One conditional update per balance change. Never read-modify-write a balance. Futures money goes **only** through `futuresLedger.run`. |
| Concurrency | Claim with a conditional update (status flip, `lockOp`), check the result, act only if you won. Engines: one in-flight pass (`runOnce`), `stop()` returns the in-flight promise, timers `unref()`ed. |
| Logging | `logger` (winston). Never log request bodies, tokens, passwords or provider error text. `logger.error` for things a human must look at (`... manual review`). |
| Errors to clients | Generic messages; details only in server logs. AI errors are mapped to short codes (`ai_not_configured`, `ai_rate_limited`...). |
| Dev-only code | Gate on `NODE_ENV === 'development'` and mark `DEV ONLY: delete when hosted`. |
| Env | Required/validated vars live in `config/config.js` (Joi). Optional ones are read with `process.env` where used and documented in `.env.example`. |

## Backend test style (Jest, `backend/tests/`)

- `tests/setupEnv.js` runs first: sets `NODE_ENV=test`, a dummy `MONGO_URI` and `JWT_SECRET`, turns demo seeding off, **ignores `backend/.env`**. Tests must never touch a real database, the network, Binance or Anthropic.
- **In-memory fakes instead of a database or mongodb-memory-server.** Typical header: `jest.mock('../config/logger', ...)`, `jest.mock('../models/User', () => ({ findOneAndUpdate: jest.fn(), ... }))`, then fakes that implement just the operators the code uses (`$inc`, `$set`, `$unset`, `$in`, conditional filters) and apply **check + apply in one synchronous step** (see `limit-orders.test.js`, `futuresLedger.test.js`, `futuresApi.test.js`). Why: MongoDB gives per-document atomicity, so the fake must too; then race tests (two orders at once, close vs TP) are deterministic and fast, and run in a sandbox with no mongod.
- Crash/idempotency tests inject a throw at each ledger step, then call `recoverAll()` and assert the balance changed exactly once and no lock remains (`futuresLedger.test.js`).
- **No supertest, no sockets.** Sandboxes may forbid binding ports. Route tests either call a controller/handler directly with a fake `res` (`auth.test.js`) or dispatch through the real Express router in-process with a hand-rolled `IncomingMessage`/`ServerResponse` pair (`futuresApi.test.js`, `settings.test.js`, `google.test.js`). `supertest` is in `devDependencies` but unused; do not start servers in tests.
- Engines expose a `_test` object (`riskEngine._test`, `alertService._test`, `futuresService._test`, `orderMatcher._test`) for internals; add to it rather than exporting internals publicly.
- Shared vectors: futures check vectors V1-V5 appear in both backend and frontend math tests; keep them in sync with `DOMAIN.md`.
- New money/security logic needs a test that fails if the logic breaks. Run `cd backend && npm test` (705 passing at 2026-11-21; frontend 35 suites / 183 tests).

## Frontend

| Topic | Convention |
|---|---|
| Structure | Pages in `pages/` own data fetching and layout; presentational pieces in `components/<area>/`; shared UI kit in `components/ui/` (`Panel`, `Card`, `Button`, `IconButton` (icon-only, aria-label + tooltip), `Tooltip` (`<Tip text>` / `useTip`: the one tooltip, portal into `document.body`, fixed + flip/clamp, hover/focus, Esc/scroll hide; use it instead of `title=` on Trade controls; `placeFixed`/`useDismiss` also position the positions-table Close menu), `Input`, `Select`, `SegTabs`, `Skeleton`, `Spinner`); pure logic in small `.js` files next to components (`alertLogic.js`, `signals.js`, `stats.js`, `heat.js`) so it is unit-testable. Files are `.js` or `.jsx` mixed. |
| State | zustand stores in `store/` for cross-page state (user, sockets-fed market/futures, alerts). Page-local state with hooks. |
| Data | `usePolling(url, ms, refreshKey, token)` (pauses when the tab is hidden, keeps last good data, path change clears data, query change keeps it with `fetching`). One axios default instance; 401 handling lives in the interceptor in `lib/api.js`. Use `API`, `authed(token)`, `errText(e)` from `lib/api`. |
| Never | Put the Authorization header or the whole axios error in `console` (`console.error(error.message)`). Send a price for a market fill. Trust client math: `lib/futuresMath.js` is preview only, the server decides. |
| Symbols | Base ticker for trading calls, `XXXUSDT` for market data/sockets/alerts; use `coin()` / `${sym}USDT` conversions from `components/liquidation/shared.js`. |

### Persisted-state hook (`lib/usePersistedState.js`)

`const [value, setValue] = usePersistedState(key, initial, { validate })` is `useState` that survives reloads. Stored in `localStorage` as JSON under `tm:v1:<userId|anon>:<key>` (so each user has their own value and logging out/in swaps it synchronously). Invalid/corrupt/stale values fail `validate` and fall back to `initial` (use `oneOf(...)` or a typeof check). Same-tab instances sync via a `tm:persist` CustomEvent, other tabs via `storage`. Blocked or full storage is swallowed: the page still works, it just forgets. Always wrap raw `localStorage` use in try/catch (`OrderCard` does for its `order-mode` key; the zustand `user-storage` key is separate and holds the JWT).

### Tailwind and styling patterns

- Dark terminal look. Tailwind config adds `brand` (blue), `surface`, `positive` `#10b981`, `negative` `#ef4444`, `warning` `#f59e0b`; app background `#070b14`; panels `rounded-xl border border-slate-800/80 bg-slate-950/60` (use `components/ui/Panel`).
- Green/emerald = long/buy/up, rose/red = short/sell/down, amber = warnings.
- Labels: `text-[11px] font-medium uppercase tracking-wider text-slate-500`. Numbers: `tabular-nums`. Interactive elements get the `focus-ring` utility class from `index.css`.
- Loading = `Skeleton`/`LoadingBlock`; refetching with data on screen = `Updating`/`Spinner`; never blank the screen on refresh.
- Canvas charts (`liquidation/*`) use hex tokens that mirror the Tailwind palette; heights depend on viewport width (`heightFor`).

### Layout rules: viewport-fit pages at `xl`

- `Layout` is `h-screen h-dvh overflow-hidden`; `<main>` is `min-h-0 flex-1 overflow-y-auto`; the page wrapper is `mx-auto max-w-[1920px] xl:h-full`.
- Below `xl` pages **stack and scroll** normally. At `xl` the Trade page fills the height under the header: root `flex flex-col gap-3 xl:h-full`, then a grid `xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_280px_300px] xl:grid-rows-[minmax(0,1fr)_minmax(140px,32%)]`.
- Every flex/grid child that must shrink needs `min-h-0` / `min-w-0` (and `xl:min-h-0`), otherwise content forces page scroll. Panels that overflow internally use `xl:overflow-y-auto` with a `max-h`/`flex-[0_1_auto]`.
- Mobile uses tab switching (`SegTabs`) with `hidden xl:flex` toggles so all panels exist at `xl` but one at a time below.
- Low-height screens hide optional panels via arbitrary variants (`xl:[@media(max-height:760px)]:hidden`).
- Reuse these utilities when adding a viewport-fit page; do not add fixed pixel heights to the page root.

### Frontend test style

- Run: `cd frontend && CI=true npm test -- --watchAll=false` (react-scripts/Jest + jsdom). **No React Testing Library**: tests render with `createRoot` inside `act()` from `react-dom/test-utils`, set `global.IS_REACT_ACT_ENVIRONMENT = true`, query with `container.querySelector`, and set input values through the native `HTMLInputElement.prototype.value` setter plus a bubbling `input` event (see `TpSlFields.test.js`).
- **`react-router-dom` jest quirk**: mock it virtually in any test whose component imports it: `jest.mock('react-router-dom', () => ({ Link: ..., useNavigate: () => jest.fn(), useSearchParams: ... }), { virtual: true })`. Without `virtual: true` the module does not resolve under CRA 5's Jest (react-router-dom 7 uses package `exports`). Provide only the hooks/components the component under test uses.
- Mock `axios` (`jest.mock('axios', ...)`) for components that fetch; **a test that imports `lib/api` without mocking axios fails to load** (`Cannot use import statement outside a module`, axios ESM). Three suites hit this at 2026-11-20; see `TODO.md`.
- Pure logic (`futuresMath`, `alertLogic`, `stats`, `heat`, `bucket`, `candleSync`, `signals`, `chartLines`) is tested without React.

### CI and builds

- **CI treats warnings as errors**: with `CI=true`, `react-scripts build` fails on any ESLint warning (unused vars/imports, `react-hooks/exhaustive-deps`, `no-unused-expressions`). Fix the cause; do not add blanket `eslint-disable`. Check locally with `CI=true npm run build`.
- **npm cache quirk**: in sandboxes where `~/.npm` is read-only, install with a throwaway cache: `npm install --cache "$TMPDIR/npm-cache"` (same for `npm ci`).
- Environment values are baked in at build time (CRA). Changing `REACT_APP_API_URL` needs a rebuild/redeploy.
