# context/ : read this first (AI agents and new engineers)

Project: **CryptoZen / trade_mvp**, a crypto paper-trading and derivatives-analytics app (real Binance futures data, liquidation heatmap, AI copilot, spot + leveraged futures paper trading, alerts). Human-facing overview and deploy guide: `../README.md`.

Snapshot date of these docs: 2026-11-20. The working tree had many uncommitted changes by several agents at that time; the code is the source of truth, these docs describe it.

## Reading order

| # | File | Read it when |
|---|---|---|
| 1 | `PROJECT.md` | You need purpose, status, goals, non-goals |
| 2 | `ARCHITECTURE.md` | You need a module map (file paths, responsibilities) or a request lifecycle (market order, limit order, futures open/close, liquidation, AI brief, alert, login/JWT) |
| 3 | `DOMAIN.md` | You touch money, fees, reservations, the futures ledger, liquidation, symbol formats. **Mandatory before editing any money path.** |
| 4 | `CONVENTIONS.md` | You write code or tests (style, in-memory fakes, jest quirks, Tailwind, layout rules) |
| 5 | `DECISIONS.md` | You wonder "why is it built this way?" before changing a design |
| 6 | `GOTCHAS.md` | Something behaves oddly (env, ports, routes, CI, Binance feed) |
| 7 | `TODO.md` | You look for open work or known gaps |

Root files: `../CLAUDE.md` and `../AGENTS.md` (short rules and commands, point here), `../docs/phase2-leverage.md` (original futures design spec; code wins where they differ).

## How to use

- Task touches **money, balance, positions, orders** -> `DOMAIN.md` + the lifecycle in `ARCHITECTURE.md` first, then the service file.
- Task touches **UI** -> `CONVENTIONS.md` (layout rules, persisted state, tests) then the page in `frontend/src/pages/`.
- Task is a **bug or odd behaviour** -> `GOTCHAS.md` before debugging.
- Before finishing: run both test suites (commands in `../CLAUDE.md`), keep the docs you made stale up to date (module map, decisions, TODO).
- Facts here use file paths without line numbers on purpose (line numbers rot). Search by name.
- Other agents may be editing the same tree. Re-read a file before editing it; do not revert changes you did not make.

## Repo at a glance

```
trade_mvp/
  backend/    Express + Socket.IO + Mongoose API, background engines (single process)   -> npm start, npm test
  frontend/   Create React App SPA (React 18, zustand, Tailwind)                        -> npm start, npm test, npm run build
  docs/       phase2-leverage.md (futures design spec)
  context/    this folder
  README.md   human overview, env reference, deployment
```
