# CLAUDE.md (trade_mvp / Paperline)

Crypto **paper-trading + derivatives analytics** app: real Binance USDS-M data, liquidation heatmap, AI copilot, spot + leveraged futures paper trading (TP/SL, liquidation engine), alerts. No real money.

## Read first
- `context/README.md` is the index. Money work: `context/DOMAIN.md` (mandatory). Module map and request lifecycles: `context/ARCHITECTURE.md`. Style and test patterns: `context/CONVENTIONS.md`. Past decisions: `context/DECISIONS.md`. Surprises: `context/GOTCHAS.md`. Open work: `context/TODO.md`.
- Human overview, architecture diagrams, env vars, deploy guide: `README.md`; full route reference: `docs/api.md`; pre-deploy checklist: `docs/pre-launch-checklist.md`. Original futures spec: `docs/phase2-leverage.md` (code wins where they differ).

## Layout
- `backend/` Express + Socket.IO + Mongoose, plus engines in the same process (`orderMatcher` 2 s, `riskEngine` 1 s, `alertService` 5 s, `botEngine` 5 s, Binance WS in `futuresService`). CommonJS.
- `frontend/` Create React App, React 18, zustand, Tailwind, ES modules.

## Commands
```bash
cd backend  && npm install && cp .env.example .env   # set JWT_SECRET (>=32 chars); Mongo must be running
cd backend  && npm start                               # node server.js on 127.0.0.1:4000 (restart to pick up changes)
cd backend  && npm test                                # jest, in-memory fakes, no DB/network
cd frontend && npm install && npm start                # http://localhost:3000 (REACT_APP_API_URL in .env.development)
cd frontend && CI=true npm test -- --watchAll=false    # react-scripts jest
cd frontend && CI=true npm run build                   # CI treats warnings as errors
# sandbox npm cache issues: npm install --cache "$TMPDIR/npm-cache"
```

## Hard rules
1. **Never commit secrets.** `backend/.env` is git-ignored; never print, overwrite or paste it. Examples go in `.env.example` with empty values.
2. **Ask before** `git push`, any deploy (Vercel, Render, Railway, Fly), publishing, spending money (API keys, cloud resources), or deleting data. Do not commit unless asked.
3. **Tests must stay green** (backend 50 suites / 1,240 tests passing; frontend 104 suites / 608 tests passing, counts as of 2026-11-27; do not add failures). Add a test that fails without your change for any money, auth or concurrency logic.
4. **Money**: integer cents in engines, house never loses a cent, one conditional update per balance change, futures money only via `services/futuresLedger.js`, fills only at the server price (`tradeFill.fillPrice`). Read `context/DOMAIN.md` first.
5. Symbol formats: trading uses `BTC`, market data/sockets/AI/alerts use `BTCUSDT`.
6. The backend is **single-instance, long-running** (not serverless); deploys are stop-then-start.
7. Other agents may be editing the same tree: re-read before editing, never revert changes you did not make, keep edits scoped.
8. Keep user-facing claims honest: paper trading, no funding, liquidation map/heatmap are estimates, liquidation feed is sampled.

## Style
Plain JS, small and boring, comments explain why. Match the file's indentation. `// ponytail:` marks deliberate shortcuts with their ceiling. Update `context/` (module map, decisions, TODO) when you change structure or rules.
