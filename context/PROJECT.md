# PROJECT

## Purpose

A paper-trading and derivatives-analytics web app for crypto. Users get a $100,000 fake balance, trade spot and leveraged perpetual futures against **real Binance USDS-M prices**, and study the market with a liquidation heatmap, derivatives dashboards, an AI copilot and alerts. Product name in the UI: **CryptoZen** (npm name `crypto-trading-mvp`).

No real money, no exchange keys, no custody. Prices are real; fills are simulated.

## Status (2026-11-20)

| Area | State |
|---|---|
| Auth (email/password, Google, JWT, settings) | Done, hardened (rate limits, revocation, locked legacy accounts) |
| Spot trading (market, limit, holdings, matcher) | Done |
| Futures paper trading (isolated margin, 1-50x, TP/SL, liquidation, ledger, risk engine) | Done; design in `docs/phase2-leverage.md` |
| Market data (Binance REST + WS, CoinGecko) | Done; needs a Binance-reachable network |
| Liquidation page (feed, treemap, map, heatmap estimate) | Done |
| Derivatives page, Dashboard, Portfolio, Settings | Done |
| AI copilot (brief, ask, alert parse) | Done; Anthropic API, or dev-only Claude CLI provider |
| Alerts (price/funding/liq, sockets, toasts) | Done |
| Hosting | Not deployed yet. Deployment plan (Vercel + long-running Node host + Atlas) is in `../README.md`; `frontend/vercel.json` exists. Blockers listed in `TODO.md` (trust proxy, logging, single-instance deploys). |
| Tests | Backend 705 passing; frontend 179 passing in 35 suites, none failing (2026-11-21). See `TODO.md`. |
| Git | Last commit is behind; large uncommitted working tree (futures engine, spot orders, AI, alerts, UI work). Do not assume `git log` reflects the feature set. |

## Goals

1. A realistic, safe practice environment: money math that never loses or duplicates a cent, even across crashes (futures ledger) and races (conditional updates).
2. Honest analytics: everything estimated is labelled as an estimate (liquidation map/heatmap, sampled liquidation feed).
3. A terminal-like, dense UI that fits one viewport at `xl` (trade page).
4. Ship-ready for a small public demo: one backend instance, Atlas, Vercel frontend.

## Non-goals (for now)

- Real trading, real funds, exchange API keys.
- Funding payments, cross margin, order-book matching/slippage simulation.
- Horizontal scaling (engines, limiter and caches are in-process).
- Multi-tenant admin tooling (`role: admin` exists in the schema but has no admin features).

## Users and data

Anyone can register (role always `user`) or sign in with Google. Each user has: `balance` (free cash), spot `holdings`, futures `Position`/`FuturesOrder` documents, `Alert`s, preferences, optional AI model choice.

## Glossary

| Term | Meaning |
|---|---|
| Base ticker | `BTC`, `ETH`. Used by spot and futures trading routes and stored on Order/Position. |
| Futures symbol | `BTCUSDT`. Used by market data routes, sockets, AI, alerts. |
| Mark price | Binance mark price; the **only** fill price the server uses. |
| Paper | Simulated. |
| Isolated margin | Each position holds its own margin; losing it all liquidates that position only. |
| Ledger / op | `futuresLedger` operation journalled in `FuturesOp`, applied exactly once. |
| Risk engine | 1 s loop that liquidates, runs SL/TP and fills futures limit entries. |
| Matcher | 2 s loop that fills spot limit orders. |
| Hold | Ref-counted server-side subscription to a symbol's mark price stream (`futuresService.hold/release`). |
