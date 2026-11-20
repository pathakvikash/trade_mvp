# AGENTS.md

Instructions for AI coding agents working in this repo (trade_mvp / CryptoZen).

The canonical, maintained instructions are in [`CLAUDE.md`](CLAUDE.md): commands, layout and hard rules (never commit secrets, ask before push/deploy, keep tests green, money rules, single-instance backend). Read it first.

Then use the context folder as the knowledge base:

- [`context/README.md`](context/README.md): index and how to use it
- [`context/ARCHITECTURE.md`](context/ARCHITECTURE.md): module map, request lifecycles
- [`context/DOMAIN.md`](context/DOMAIN.md): money rules, ledger, liquidation (read before any money change)
- [`context/CONVENTIONS.md`](context/CONVENTIONS.md): code and test style, jest quirks, layout rules
- [`context/DECISIONS.md`](context/DECISIONS.md), [`context/GOTCHAS.md`](context/GOTCHAS.md), [`context/TODO.md`](context/TODO.md)

Human-facing overview, env reference and deployment guide: [`README.md`](README.md).
