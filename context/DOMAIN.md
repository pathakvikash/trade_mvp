# DOMAIN: money rules and trading semantics

Read before touching any money path. The code is authoritative; `../docs/phase2-leverage.md` is the original futures spec (differences: code adds `Position.rev`, `OP_FAILED`, `BAD_SIZE`, lock `expect` filters, marker sweep).

## Units and formats

| Thing | Rule |
|---|---|
| Engine money | **Integer cents** inside `tradeMath` / `futuresMath` / ledger specs. |
| Stored money | USD floats on documents (`User.balance`, `Position.margin`, `Order.reserved`, ...) = `cents / 100`. Convert with `usd(c) = c/100`, `cents(d) = Math.round(d*100)`. |
| Coin size | `round8` (8 decimals). Max order size 1e9. |
| Price | float USD; max 1e9 on inputs. |
| Float noise | `notionalCents = Math.round(amount*price*100*1e6)/1e6` (round to 1e-6 cent) so `499.99999999` cannot flip a ceil/floor. `futuresMath` `ceilCents/floorCents` do the same. |
| Rounding policy | **The house never loses a cent**: fees round **up**, margin rounds **up**, PnL and released margin round **down**, buy totals ceil, sell totals floor. |
| Symbol: base ticker | `BTC`. Regex `^[A-Z0-9]{2,20}$`. Used by `/api/trades`, `/api/orders`, `/api/futures/*`, `Order.symbol`, `Trade.cryptoSymbol`, `Position.symbol`, `holdings.<SYM>` keys, `FuturesOrder.symbol`. |
| Symbol: futures symbol | `BTCUSDT`. Regex `^[A-Z0-9]{2,20}USDT$` (`futuresUtils.isValidSymbol`). Used by `/api/market/*`, sockets, AI, alerts, `User.preferences.defaultSymbol`. |
| Conversion | `${base}USDT` and `sym.replace(/USDT$/, '')`. Only symbols in Binance `exchangeInfo` (TRADING, PERPETUAL, USDT quote) are tradable (`futuresRest.isKnownSymbol`); if exchangeInfo never loaded the regex alone decides. |
| Holdings keys | Must match `SYMBOL_RE` before use in a Mongo path (`holdKey` throws otherwise): a `.` or `$` would break `$inc`. |

## Prices

Fills use only the server's price: `tradeFill.fillPrice(futuresSymbol)` -> `{price, ageMs}`:
1. `futuresService.getMark` (websocket markPrice stream) if <= 3 s old;
2. else `futuresRest.markPrice` (REST `premiumIndex`, cached 2 s) if <= 10 s old;
3. else the `overview` row (<= 10 s, or untimestamped);
4. else `null` -> API 503 (`NO_PRICE` for futures). Engines skip the symbol for that pass (never act on a stale mark).

The client never sends a fill price (limit orders send a *limit* price, which is the fill price of that order type).

## Spot (`tradeMath`, `tradeFill`)

| Rule | Value |
|---|---|
| Starting balance | $100,000 (`User.balance` default, `User.PAPER_BALANCE`). Legacy zero-balance users with no trades get it once at login. |
| Fee | 0.1%: `fee = max(1, ceil(notional/1000))` cents. |
| Quote | buy `total = ceil(notional + fee)`; sell `total = floor(notional - fee)`. A round trip at one price always loses >= both fees. |
| Min order | $5 notional (`MIN_NOTIONAL_CENTS = 500`). |
| Market order | fills now at `fillPrice`; one conditional update moves balance and holding together (no overdraft, no oversell). |
| Limit order | **Reserves** at placement: buy reserves `total/100` USD (at the limit price, incl. fee); sell reserves the coins (removed from holdings). Max 20 open orders. Matcher fills when buy: mark <= limit, sell: mark >= limit, **at the limit price**. Cancel/reject releases the reservation; exactly one of {fill, cancel, reject} wins via a conditional status flip. |
| Holdings | Authoritative on `User.holdings` (Map). Lazily bootstrapped from `Trade` history once (`holdingsSyncedAt`). Dust < 1e-8 is zero. |
| Average cost | `tradeMath.avgCost(trades)`: walks trades oldest first; sells remove cost proportionally; a position that hits zero resets. Computed on read, not stored. |
| Idempotency | `executeFill` = one conditional `findOneAndUpdate` on `User`, then `Trade.create`; if the insert fails the `$inc` is reversed. `e.compensationFailed` means applied-but-unrecorded and unreversed: the matcher parks the order as `error` (never retries). |

## Futures (`futuresMath`, `futuresController`, `futuresLedger`, `riskEngine`)

Isolated-margin, USDT-margined **linear** perpetuals. Margin comes out of the same `User.balance`. Funding is ignored (`fundingIgnored: true` in `/config`).

### Parameters (constants in `services/futuresMath.js`, served by `GET /api/futures/config`)

| Item | Value |
|---|---|
| Taker fee | 5 bps (0.05%) on every open / add / close notional, `max(1, ceil(...))` cents. Liquidation charges **no** fee. |
| Margin | `ceil(notional / leverage)` cents. Open debit = margin + fee. |
| Leverage | integer 1..50. Cap = `min(symbolCap, tier(notional).maxLev)`; `symbolCap`: BTC 50, ETH 50, default 20. |
| Tiers (notional USD <=) -> maxLev, mmr | 50k -> 50x, 0.4%; 250k -> 20x, 0.5%; 1M -> 10x, 1.0%; 5M -> 5x, 2.5%; above -> 2x, 5.0% |
| Limits | min notional $5; max 20 open positions; max 20 open futures orders; `size` round8 > 0, <= 1e9 |
| Positions | One isolated position per user + symbol + side (`activeKey = userId:symbol:side`, unique sparse index). A long and a short on the same symbol may coexist. |
| Leverage change | `PATCH /positions/:id {leverage}` on an open position: new margin = `ceil(notional(size, entry) / newLev)` cents (the open rule, on the ENTRY notional); `delta = oldMargin - newMargin` credited (+) or debited (-, guarded, 400 `INSUFFICIENT_BALANCE`). mmr kept; liq recomputed. 400 `LIQ_BREACH` if the new liq is at/through the mark (long `liq >= mark`, short `liq <= mark`); 400 `LEVERAGE_TOO_HIGH` above the cap for `size*entry`; same leverage = no-op. One `leverage` ledger op; tp/sl in the same PATCH go into its frozen `post` (atomic), and the SL in force (new or kept) is checked against the NEW liq. Pending same-side limit orders at the old leverage are rejected + refunded when they fill (`LEVERAGE_MISMATCH`). |
| Add to position | Same leverage required (409 `LEVERAGE_MISMATCH`); size-weighted entry; margin sums; mmr/liq recomputed on the combined notional; tier cap checked on the combined notional. |

### Formulas

```
notional      = notionalCents(size, price)
fee           = max(1, ceil(notional * 5 / 10000))
margin        = ceil(notional / leverage)
liq (long)    = (entry - M/size) / (1 - mmr)         M = isolated margin USD (after adds), fees excluded
liq (short)   = (entry + M/size) / (1 + mmr)         clamped >= 0, round8
liquidated when long: mark <= liq ; short: mark >= liq     (derived from M + pnl(mark) <= mmr * size * mark)
pnl (cents)   = floor(100 * sign * closeSize * (exit - entry))      sign: long +1, short -1
released      = final close: all remaining margin; partial: floor(margin * closeSize / size)
close credit  = max(0, released + pnl - closeFee)
liquidation   = credit 0, realizedPnl += -margin (gross), margin 0
unrealized    = sign * size * (mark - entry)  (display only);   ROE% = unrealized / margin * 100
equity        = balance + sum(margin + unrealized) over open positions + sum(reserved) of open futures orders
```

Check vectors (backend `tests/futuresMath.test.js`, frontend `lib/futuresMath.test.js`):

| | Setup | Result |
|---|---|---|
| V1 | long size 1 @100, 10x | notional 10000c, fee 5c, margin 1000c, debit 1005c, liq 90.36144578 |
| V2 | short size 2 @100, 20x | notional 20000c, fee 10c, margin 1000c, debit 1010c, liq 104.58167331 |
| V3 | close V1 fully @110 | pnl 1000c, fee 6c, credit 1994c |
| V4 | V1 + add 1 @120, 10x | size 2, entry 110, margin 2200c, liq 99.39759036 |
| V5 | partial close V4 size 0.5 @110 | released 550c, pnl 0, fee 3c, credit 547c, liq unchanged |

### TP / SL

Optional at entry (market and limit) and editable via PATCH on the position or on an open limit order (`PATCH /orders/:id`, bounds vs the limit price and its quoted liq; the risk engine pins the order's tp/sl in its fill lock filter so an edit racing a fill is never lost) (`null` clears). Bounds vs the reference price (mark for market/edit, limit price for a limit entry): long `liq < sl < ref < tp`; short `tp < ref < sl < liq` (else 400 `BAD_TPSL`). On a limit fill they are copied to the position (on an add, non-null values overwrite). Triggered on the **mark** by the risk engine and executed as a market close of the whole position at the mark. Precedence per pass: liquidation, then SL, then TP.

### Limit entries and reservations

`place` op debits `margin + fee` computed at the limit price and stores it as `FuturesOrder.reserved`. The risk engine fills at the **limit price** (open or add): `fill` op with `deltaCents = reserved - debit` (normally 0). Cancel op credits `reserved` back. Fill failures that cannot be satisfied (leverage mismatch with an existing position, tier cap exceeded) reject the order and refund the reservation.

### Ledger: exactly-once design (`services/futuresLedger.js`)

Problem: a balance change and a position change are two documents; a crash between them must neither lose nor duplicate money, and no compensating writes are allowed.

Mechanism (write-ahead journal + claim + marker):

| Step | Action | Crash here means |
|---|---|---|
| 1 | Insert `FuturesOp{status:'pending', deltaCents, post (frozen final state per target)}` | nothing applied; recovery finds no locks and no marker -> `rolled_back` |
| 2 | Lock each target in order: set `lockOp = op._id` (existing docs via filter `{lockOp:null, status, size, rev}`; new docs created with `lockOp`). Duplicate `activeKey` (E11000) -> `onDuplicate` rebuilds as an add, once. Any lock fails -> unlock, `rolled_back`, `POSITION_BUSY` | partial locks; recovery sees a target not locked by us and no marker -> `INCOMPLETE_LOCK` roll back |
| 3 | ONE `User.updateOne` guarded by `futuresOps.<opId>` not existing (and `balance >= debit` for debits): `$inc balance`, `$set` marker | marker present = applied; absent = not applied. Insufficient funds -> roll back, `opening`/`placing` docs become `void`, `activeKey` unset |
| 4 | Apply frozen `post` to each target (`updateOne` filtered on `lockOp: op._id`, `$inc rev` for Position, `$unset lockOp`) | idempotent via `lockOp` filter; recovery re-runs it |
| 5 | Op `done` | recovery re-runs 3 (skipped: marker), 4 (no-op), 5 |
| 6 | Remove the marker | op `done` + marker present -> cleanup only (also by the periodic `recoverAll` sweep) |

Rules that follow:
- **Roll forward only.** Recovery (`recover`) re-derives state from the journal; it never computes new numbers. Anything that fixes the amounts must be frozen into the op at step 1.
- The marker outlives every later step, so "marker present" is the single truth that the money moved.
- `attempts++` per recovery try; at `MAX_ATTEMPTS = 10` the op becomes `error`, targets stay locked (frozen, "under review"), `FUTURES OP ERROR ... manual review` is logged. Only persistent DB failure or a missing user gets there.
- In-process `serial(opId)` prevents `recover()` interleaving with the `run()` still executing the same op. Cross-process safety rests on the recovery **age gate (15 s)** and on deploys being stop-then-start.
- Balance guard tolerates float drift `DUST = 1e-6` USD.
- The engine and the API both call `ledger.run`; a user close racing a TP/SL/liquidation: the lock is the claim, the loser gets `POSITION_BUSY` (API retries show 409; the controller turns it into `NOT_OPEN` if the position closed meanwhile).
- TP/SL edits do not use the ledger (no money moves) but do honour `lockOp` and bump `rev`. A PATCH that also changes leverage is a `leverage` ledger op (margin moves) carrying tp/sl in its `post`.
- `rev` on Position is a monotonic version bumped by every mutation; lock filters pin `{status, size, rev}` so an A-B-A snapshot cannot match.

## Account deletion

`DELETE /api/auth/me` is refused (409 `OPEN_FUTURES`) while any position is `opening`/`open`, any futures order is `placing`/`open`, or any `FuturesOp` is `pending`/`error`, so no ledger money is orphaned. Paper balance is simply deleted with the user.

## Alerts (units)

`metric`: `price` = mark price USD; `funding` = funding rate **percent** (0.01 means 0.01%; the socket/service convert `rate * 100`); `liq_usd_5m` = USD liquidated across both sides in the last 5 minutes from the sampled buffer. `op`: strict `above` (`>`) / `below` (`<`). Cooldown 1..1440 min (default 15); hard floor 60 s between fires; a changed `value` resets the cooldown.

## Liquidation analytics (estimates)

- **Real feed**: Binance `!forceOrder@arr` normalised (`SELL` force order = a long liquidated). Sampled by the exchange (<= 1 event/s/symbol): totals understate reality. Buffer: up to 5000 events/symbol, 24 h, mirrored to Mongo (TTL 2 d) and reloaded at boot.
- **Map/heatmap** (`futuresUtils.estimateLiqLevels` / `estimateLiqHeat`): every rise in hourly (or per-range) open interest USD is treated as new positions, split 50/50 long/short over a leverage mix (5..125x), entries at the candle low/typical/high (25/50/25%), liq = `entry * (1 -/+ (1/lev - 0.004))`; a level disappears once a later candle crosses it. Ignores closes and funding. Present it as relative density, not real positions; the AI system prompt says so too.
