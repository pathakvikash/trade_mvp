# TODO (open items and known gaps, 2026-11-20)

Priority: P0 blocks hosting, P1 should do soon, P2 nice to have. Remove an item when done (and add a `DECISIONS.md` line if it changed a design).

## P0: before the first public deploy

Done 2026-11-20: `TRUST_PROXY`, always-on console logging (`LOG_TO_FILES`), `GET /api/health`, production `HOST` default, production config checks. On the host set `TRUST_PROXY=1`, point the health check at `/api/health`.


- [ ] Choose a backend host region that Binance does not block (non-US); verify `/api/market/futures/overview` after deploy.
- [ ] Confirm the host's deploy mode can be **stop-then-start with 1 instance** (Render/Railway/Fly knobs not verified yet).
- [ ] Decide whether to delete the dev-only code (`dev-hint` route, Login card, CLI AI provider); it is inert outside `NODE_ENV=development` and demo seeding is now refused in production.
- [ ] Atlas network access policy (static egress IP vs `0.0.0.0/0` with strong creds), backups.
- [ ] Production `frontend/.env.production` value (`REACT_APP_API_URL`) or set it in Vercel; make sure CORS_ORIGINS and Google origins match.

## P1: correctness and quality

- [ ] **Frontend test suites failing to load** (`Cannot use import statement outside a module`, axios ESM through `lib/api.js`): `pages/Market.test.js`, `pages/Liquidation.test.js`, `components/trade/SymbolLiquidations.test.js`. Fix by mocking axios in those tests or adding `transformIgnorePatterns`/a `moduleNameMapper` for axios in `package.json` `jest` config (CRA supports a limited set). Cause not fully verified; may be tied to in-flight changes to `lib/api.js`.
- [ ] Frontend env: `futuresStore.js` still builds its base URL from the raw `REACT_APP_API_URL` (no trailing-slash strip like `lib/api.js`); unify on `API` from `lib/api`.
- [ ] Count-then-insert caps (20 positions, 20 futures orders, 20 spot orders, 20 alerts) can overshoot by a few under parallel requests (`// ponytail:` markers). Fix with an atomic counter if abuse matters.
- [ ] `FuturesOp` journal has no TTL (done/rolled_back rows accumulate). Add a TTL index on terminal ops once recovery windows are settled.
- [ ] Push events for liquidation / TP / SL / limit fills (currently 3 s polling; toasts lag).
- [ ] `docs/phase2-leverage.md` is stale in places (`rev`, `OP_FAILED`, `BAD_SIZE`, marker sweep): update the doc or mark it historical.
- [ ] Brief cache in `routes/aiRoutes.js` is unbounded by symbol count (valid symbols only); cap if abused.
- [ ] No frontend tests for the `Trade`, `Dashboard`, `Derivatives` pages.

## P2: product and platform

- [ ] Account features: email verification, password reset, refresh tokens/httpOnly cookie session (JWT is in `localStorage`), 2FA.
- [ ] Funding simulation, cross margin, leverage change on open positions, reduce-only limit exits, trailing stops.
- [ ] Redis-backed rate limiter and a leader lock so more than one backend instance can run; move engines to a worker.
- [ ] Leaderboard / competitions, trade export, per-user equity history chart.
- [ ] Migrate off Create React App (Vite), replace placeholder `public/index.html` title/description and the marketing copy on `/`.
- [ ] Remove dead code: `CompanyDash.jsx`, `components/company/*`, `components/CompanyViewModel.js`, `CompDash.css`; decide on `components/LiquidationHeatmap.js` vs `components/liquidation/*`.
- [ ] Screenshots for the README (`docs/screenshots/`), a Dockerfile/compose for local Mongo + backend, CI workflow running both test suites and `CI=true npm run build`.
- [ ] Admin tooling (the `role: admin` field is currently unused).
