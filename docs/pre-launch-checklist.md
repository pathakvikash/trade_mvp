# Pre-launch checklist

See also the Deployment and Security sections of [`README.md`](../README.md).

- [ ] `NODE_ENV=production`, fresh `JWT_SECRET` (48+ random bytes), no placeholder values.
- [ ] Backend reachable over HTTPS (`HOST` defaults to `0.0.0.0` in production); `TRUST_PROXY=1` set; platform health-check path is `GET /api/health` (`{ok, uptime, mongo: up or down}`, public, 200 even if Mongo is down); frontend `REACT_APP_API_URL` points at it and the app was **rebuilt** after setting it.
- [ ] `CORS_ORIGINS` lists exactly the production frontend origin(s); verify login, a market order and the live chart from the deployed frontend.
- [ ] `TRUST_PROXY` set (usually `1`) and rate limiting verified per client.
- [ ] Backend region is not blocked by Binance; `/api/market/futures/overview` returns data.
- [ ] Exactly one backend instance; deploys are stop-then-start.
- [ ] MongoDB Atlas: strong user password, network access decided, backups on, connection string in the host's secrets.
- [ ] `SEED_DEMO_USERS` is off (or consciously on with a strong `DEMO_GUEST_PASSWORD`); no real accounts use the seeded guest.
- [ ] Review any `role: admin` users in the database (startup logs a SECURITY warning if some exist).
- [ ] Google OAuth: production origin added to Authorized JavaScript origins; `GOOGLE_CLIENT_ID` set on the backend; consent screen published if needed.
- [ ] AI: `ANTHROPIC_API_KEY` set (or AI left off); `AI_MAX_CALLS_PER_HOUR` set to a budget you accept; CLI provider cannot activate (`NODE_ENV=production`).
- [ ] Logging: confirm the host's log viewer shows the backend's JSON console output.
- [ ] No secret committed: `git ls-files | grep -i env` shows only `.env.example` / the frontend public-value env files; rotate anything that ever leaked.
- [ ] `CI=true npm run build` passes locally; backend and frontend tests are green.
- [ ] Decide on the dev-only code (`dev-hint` route and Login card) and remove it if you prefer not to ship it (it is inert unless `NODE_ENV=development`).
- [ ] UI states clearly that this is paper trading with simulated fills and no funding.
- [ ] Bots: leave `BOTS_ENABLED` unset (off) unless the instance is always-on and you accept the risk of missed bars.
