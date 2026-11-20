# Phase 2: leveraged paper futures (isolated margin, TP/SL)

Status: design frozen for implementation. Spot (market + limit, `holdings`) is not touched: no edits to
`tradeController`, `orderController`, `orderMatcher`, `tradeFill`, `Order`, `Trade`. Spot tests stay green.

Futures is a separate engine: USDT-margined linear perpetuals, isolated margin, long/short, margin paid from the
same `User.balance`. Funding is ignored (no funding payments, ever; say so in the UI tooltip). Prices: the server mark
via `tradeFill.fillPrice(`${base}USDT`)` (same source as spot fills). The client never sends a fill price.

## 1. Data model

All money is integer cents inside the engine (`tradeMath` style); stored dollar fields are `cents / 100`.

### Position (`backend/models/Position.js`)
```
userId        ObjectId, required
symbol        String  base ticker, SYMBOL_RE ('BTC')
side          'long' | 'short'
size          Number  coins, round8, > 0 while open
entryPrice    Number  size-weighted average
leverage      Number  integer 1..50
margin        Number  USD isolated margin currently held by the position
mmr           Number  maintenance margin rate fixed at open/add (tier of notional at that time)
liqPrice      Number  see §3
tp, sl        Number | null  trigger prices on mark
status        'opening' | 'open' | 'closed' | 'liquidated' | 'void'   ('void' = open rolled back, never shown)
activeKey     String  `${userId}:${symbol}:${side}` while opening/open, $unset on close/liquidate/void
realizedPnl   Number  USD, gross price PnL realised so far (partial closes accumulate)
fees          Number  USD, open + close fees paid so far
exitPrice     Number  last close price (set on final close)
closeReason   'manual' | 'tp' | 'sl' | 'liquidation'
lockOp        ObjectId | null  the FuturesOp currently mutating it (the claim)
openedAt, updatedAt, closedAt  Date
```
Indexes: `{activeKey:1}` unique sparse (one isolated position per user+symbol+side, race-safe);
`{userId:1,status:1,updatedAt:-1}`; `{status:1}`.

### FuturesOrder (`backend/models/FuturesOrder.js`) — limit ENTRY orders only
```
userId, symbol, side('long'|'short'), size, leverage, limitPrice, tp, sl
reserved      Number USD = margin + open fee at limitPrice (taken at placement)
status        'placing' | 'open' | 'filled' | 'cancelled' | 'rejected' | 'void'
lockOp        ObjectId | null
positionId    ObjectId (set on fill), createdAt, filledAt
```
Index `{userId:1,status:1,createdAt:-1}`, `{status:1}`. Reduce-only limit exits are out of scope: TP/SL cover them.

### FuturesOp (`backend/models/FuturesOp.js`) — write-ahead journal, the exactly-once mechanism
```
userId, kind: 'open'|'add'|'close'|'liquidate'|'tp'|'sl'|'place'|'cancel'|'fill'
targets       [{ model: 'Position'|'FuturesOrder', id }]   locked in this order
deltaCents    Integer  balance change (negative = debit)
post          { [targetId]: { ...absolute $set fields, $unset?: [...] } }   frozen final state per target
status        'pending' | 'done' | 'rolled_back' | 'error'
attempts      Number, lastError String, createdAt Date
```
Index `{status:1,createdAt:1}`. TTL on `done`/`rolled_back` is optional (skip until it matters).

### User (additive only)
`futuresOps: { type: Map, of: Number }` — per-op idempotency marker, key = op `_id` hex (path-safe). Declared in the
schema or Mongoose strict mode drops the `$set`. Balance rules unchanged: `balance` is free cash.

### Money maths (`backend/services/futuresMath.js`, pure; export `notionalCents` from `tradeMath`, additive)
```
TAKER_FEE_BPS = 5                         0.05% on every open/add/close notional, min 1 cent, ceil
notional  = notionalCents(size, price)    (from tradeMath)
fee       = max(1, ceil(notional * 5 / 10000))
margin    = ceil(notional / leverage)     cents
open debit = margin + fee                 (limit order: computed at limitPrice; reserved in full)
pnl(c)    = floor(100 * (long ? size*(exit-entry) : size*(entry-exit)))   floor = house never loses a cent
released  = partial: floor(margin * closeSize / size); final close: all remaining margin
close credit = max(0, released + pnl - closeFee)   (0 only if a close happens past liq; log it)
liquidation credit = 0                    (whole isolated margin forfeited)
```
Exports: `TIERS, SYMBOL_MAX_LEV, maxLeverage(symbol, notionalUsd), tierOf(notionalUsd), openQuote(side,size,price,lev)
-> {notional, fee, margin, debit, mmr, liqPrice}, liqPrice(side, entry, size, marginUsd, mmr), closeQuote(pos, closeSize,
exit) -> {pnl, fee, released, credit}, addQuote(pos, size, price) -> {size, entryPrice, margin, mmr, liqPrice, fee, debit},
unrealized(pos, mark) -> {pnl, roe}`.

Leverage caps (constants, also served by `GET /api/futures/config`):
```
SYMBOL_MAX_LEV = { BTC: 50, ETH: 50 }, default 20
TIERS (position notional USD <=) : maxLev, mmr
  50_000      : 50, 0.004
  250_000     : 20, 0.005
  1_000_000   : 10, 0.010
  5_000_000   :  5, 0.025
  Infinity    :  2, 0.050
allowed leverage = min(symbol cap, tier(notional after the op).maxLev)
```
Limits: min notional $5 (`MIN_NOTIONAL_CENTS`), max 20 open positions per user, max 20 open futures orders,
size round8 and <= 1e9, leverage integer.

## 2. Order semantics

- **Market entry** (`type:'market'`): price = server mark. If the user has an open position on symbol+side -> `add`,
  else `open`. Debit = margin + fee, conditional on `balance >= debit`.
- **Limit entry** (`type:'limit'`): `place` op reserves margin+fee at limitPrice; the risk engine fills when
  long: mark <= limit, short: mark >= limit, at the LIMIT price (as spot). Fill = `fill` op: open or add, delta 0
  (reservation equals the cost exactly). Cancel = `cancel` op, credit `reserved`.
- **Add to position**: one isolated position per user+symbol+side. Adding requires the SAME leverage as the open
  position (else 409 `LEVERAGE_MISMATCH`; changing leverage on an open position is out of scope). New entry =
  size-weighted average, margin = old + new, mmr/tier and liq recomputed; tier cap is checked on the combined notional.
  Long and short on the same symbol may coexist (hedge-style, separate isolated positions).
- **Close** (reduce-only by construction): `POST /positions/:id/close {size?}`; omit = full. Partial must leave
  remaining notional >= $5 at mark, else 400 `MIN_NOTIONAL` ("close all instead"). Liq price unchanged by partial
  close (margin/size ratio is preserved). Exit at mark, taker fee.
- **TP/SL**: optional at entry (market and limit; on a limit they are copied to the position on fill and, on an add,
  a non-null value in the request overwrites the position's) and editable later via PATCH. Validation vs the reference
  price (mark for market/edit, limitPrice for limit): long `tp > ref`, `liq < sl < ref`; short `tp < ref`,
  `ref < sl < liq`. `null` clears. Triggered on mark, executed as a market close of the whole position at mark.

## 3. Liquidation, risk engine, exactly-once settlement

**Liq price (isolated, linear)**. Liquidated when equity <= maintenance: `M + pnl(mark) <= mmr * size * mark`.
```
long : liq = (entry - M/size) / (1 - mmr)
short: liq = (entry + M/size) / (1 + mmr)
```
M = position margin in USD (after adds), fees excluded. Check vectors (shared by backend + frontend tests):
```
V1 long  size 1  @100 L10 : notional 10000c fee 5c margin 1000c debit 1005c liq 90.36144578 (90/0.996)
V2 short size 2  @100 L20 : notional 20000c fee 10c margin 1000c debit 1010c liq 104.58167331 (105/1.004)
V3 close V1 full @110     : pnl 1000c fee 6c (ceil 5.5) credit 1994c ; net vs start +989c
V4 V1 + add 1 @120 L10    : size 2 entry 110 margin 2200c liq 99.39759036 (99/0.996)
V5 partial close V4 size 0.5 @110 : released 550c pnl 0 fee 3c (ceil 2.75) credit 547c ; liq unchanged
```

**Op executor** (`backend/services/futuresLedger.js`, single code path for API and engine):
```
run(opSpec) -> { op, ok, code? }
 1. FuturesOp.create({status:'pending', ...frozen numbers from the snapshot read})
 2. lock each target in order: findOneAndUpdate({_id, lockOp:null, status:<expected>, size:<snapshot size>},
    {$set:{lockOp: op._id}})  (open: Position.create({status:'opening', activeKey, lockOp}); E11000 on activeKey ->
    re-read and retry once as 'add'). Any lock fails -> unlock the ones taken, op 'rolled_back', return POSITION_BUSY.
 3. User.updateOne({_id, ['futuresOps.'+op._id]: {$exists:false}, ...(delta<0 && {balance:{$gte:-delta/100}})},
    {$inc:{balance: delta/100}, $set:{['futuresOps.'+op._id]: 1}})
    matched 0: marker present -> already applied, continue; else insufficient funds -> unlock, op 'rolled_back'
    (opening position -> status 'void', activeKey unset; placing order -> 'void'), return INSUFFICIENT_BALANCE.
 4. for each target: updateOne({_id, lockOp: op._id}, {$set: post[id], $unset: {lockOp:1, ...}})   idempotent via lockOp
 5. FuturesOp status 'done'.   6. User $unset futuresOps.<id>  (only ever after 5).
```
**Recovery** (`ledger.recover(op)`), the only crash handling; there are no compensating writes:
- target still has `lockOp == op._id` -> redo 3 (idempotent; a debit that now fails funds -> roll back as in 3), 4, 5, 6.
- no target locked by op AND marker present -> 4 already ran -> 5, 6.
- no target locked by op AND marker absent -> nothing was applied -> 'rolled_back' (void an 'opening'/'placing' doc).
- op 'done' with marker still set -> 6.
Every step is idempotent, so recovery always rolls forward from the journal. Crash windows covered: after 1 (rolled
back), after 2 (resume), between 3 and 4 (resume), between 4 and 5 (done), between 5 and 6 (marker cleanup).
Retry cap: `attempts++` per recovery try; at 10 -> status `'error'`, targets stay locked (frozen, excluded from the
engine, shown as "under review"), `logger.error('FUTURES OP ERROR ...manual review')`. That is the only terminal error
state; it is reached only by persistent DB failure or a missing user.

**Risk engine** (`backend/services/riskEngine.js`, `orderMatcher` pattern):
- `setInterval` 1000 ms, `unref`, skip unless `mongoose.connection.readyState === 1`; `runOnce()` keeps one in-flight
  pass (`current` promise), never overlapping. `stop()` clears the timer and returns `current` for draining.
- Each pass: (a) recover pending ops older than 15 s (limit 50); (b) load `Position{status:'open', lockOp:null}` and
  `FuturesOrder{status:'open', lockOp:null}` (limit 2000 each, oldest first), group by symbol; (c) reconcile
  `futuresService.hold/release` for those symbols exactly like `alertService.reconcile` (release all in `stop()`);
  (d) per symbol `fillPrice()`; no fresh price -> skip symbol this pass (never act on a stale mark);
  (e) per position, first match wins: liquidation (long mark <= liq, short mark >= liq) -> `liquidate`;
  SL crossed -> `sl`; TP crossed -> `tp`; (f) crossed limit orders -> `fill`.
- Each action is one `ledger.run`; the lock in step 2 is the claim, so a user close racing a TP/liq settles once and
  the loser gets POSITION_BUSY / skips. A pass yields between symbols (`await`), does O(n) work, no sync loops over DB.
- `server.js`: start after `orderMatcher.start()`; on shutdown `await Promise.race([Promise.all([matcherDone,
  riskDone]), timeout5s])`. Startup: `ledger.recoverAll()` once (all pending, any age) before the first pass.
- Positions ignored while `lockOp` is set; a crash leaves them locked until recovery (<= 15 s or next start).

## 4. PnL / ROE
```
unrealized pnl = long: size*(mark-entry) ; short: size*(entry-mark)       (USD, display only, no rounding rule)
ROE %          = unrealized pnl / margin * 100
realizedPnl    = sum of gross pnl over closes ; fees = sum of open+close fees ; net = realizedPnl - fees
liquidation    : realizedPnl = -margin_at_liq (gross), credit 0
equity         = balance + Σ(margin + unrealized pnl) over open positions + Σ reserved of open futures orders
```
Funding: ignored, stated in the API config (`fundingIgnored: true`) and as a UI hint.

## 5. API (`/api/futures`, `auth` on all; JWT user only, body userId ignored)

Responses keep `{success, message}` and add `code` on errors. Write routes:
`limitBy({limit:30, windowMs:60000}, req => 'fut:'+req.user.userId)`. Reads are not limited (poll 3 s).

| Method/path | Body | 2xx |
|---|---|---|
| GET `/config` | – | `{takerFeeRate:0.0005, minNotional:5, maxPositions:20, maxOrders:20, symbolMaxLev:{BTC:50,ETH:50}, defaultMaxLev:20, tiers:[{maxNotional, maxLev, mmr}], fundingIgnored:true}` (`Infinity` -> `null`) |
| POST `/orders` | `{symbol, side:'long'\|'short', type:'market'\|'limit', size, leverage, limitPrice?, tp?, sl?}` | 201 market `{position, fill:{price, fee}, balance}`; limit `{order, balance}` |
| GET `/orders` | – | `{orders: open, closed: last 20}` |
| DELETE `/orders/:id` | – | `{order, balance}` |
| GET `/positions` | – | `{positions: open (incl. `busy: lockOp!=null`, `markPrice` snapshot or null), closed: last 20}` |
| POST `/positions/:id/close` | `{size?}` | `{position, close:{size, price, pnl, fee, credit}, balance}` |
| PATCH `/positions/:id` | `{tp?: number\|null, sl?: number\|null}` (at least one key) | `{position}` |

Validation (`middleware/validator.js` `futuresOrderRules/closeRules/tpslRules`, express-validator, 422 on shape):
symbol `/^[A-Z0-9]{2,20}$/` and `futuresRest.isKnownSymbol(sym+'USDT')`; size finite number 0<size<=1e9 (round8 >0);
leverage integer 1..50; limitPrice required iff limit, finite >0 <=1e9; tp/sl optional finite >0 or null; unknown
keys rejected. `:id` 24-hex else 404.

Error codes (status, code): 400 `INSUFFICIENT_BALANCE`, 400 `MIN_NOTIONAL`, 400 `LEVERAGE_TOO_HIGH` (message names
the allowed max for this notional), 400 `MAX_POSITIONS`/`MAX_ORDERS`, 400 `BAD_TPSL` (message says which bound),
400 `UNKNOWN_MARKET`, 401, 404 `NOT_FOUND` (other users' ids look the same), 409 `POSITION_BUSY` (locked, retry),
409 `NOT_OPEN`, 409 `LEVERAGE_MISMATCH`, 422 validation, 429 limiter, 503 `NO_PRICE`.

## 6. Frontend UX

- **OrderCard** (new, replaces `<TradeForm>` in `pages/Trade.js`): one Panel with a Spot | Futures `SegTabs` (choice in
  `localStorage` via try/catch). Spot renders today's `TradeForm` unchanged (add an optional `header` prop only if
  needed to place the switch inside its Panel; `TradeForm.test.js` must stay green). Futures renders `FuturesForm`.
- **FuturesForm**: Long / Short buttons (emerald/rose like Buy/Sell), Market | Limit tabs, Size (coins) input,
  `LeverageControl`, optional `TpSlFields`, preview rows: notional, margin, fee (0.05%), liq price, available balance;
  submit "Open long 10x BTC". Disabled with a visible reason when: no price, config not loaded, size <= 0, leverage over
  cap, preview debit > balance, invalid TP/SL. Server errors shown in the existing message box (429 -> "slow down").
- **LeverageControl** `{value, max, onChange, disabled}`: presets `[1,2,5,10,20,50].filter(x<=max)` + `<input
  type=range min=1 max={max} step=1>` + "10x" label; `max` = `maxLeverage(symbol, notional)` from config, recomputed as
  size changes (value clamped down with a note "max 20x at this size").
- **TpSlFields** `{side, refPrice, liqPrice, value:{tp,sl}, onChange, idPrefix}`: checkbox "TP/SL"; two inputs with a
  Price | % switch (% = price move from ref; shows resulting price and est. PnL/ROE); inline errors with the §2 bounds.
  Emits prices (or null). Reused by the PositionsTable edit popover.
- **PositionsTable** `{positions, prices, onClose(id,size?), onEditTpSl(id,{tp,sl}), busyId}`: columns Symbol (side +
  lev badge), Size, Entry, Mark, Liq, Margin, PnL (ROE%), TP/SL (Edit), Actions (Close, Close 50%; confirm-free like
  spot cancel). Mark = futures store mark for the open symbol, else overview price, else "--" with PnL "--".
  `busy` rows show "under review"/spinner and disable actions. Closed tab rows show reason (TP/SL/Liquidated).
- **BottomStrip** tabs: Positions (futures, `PositionsTable`) | Holdings (spot rows exactly as today) | Open orders
  (spot rows as today + futures limit rows with a "Futures" badge, cancel routed to `/api/futures/orders/:id`) |
  History | AI Copilot.
- **lib/useFutures(token)**: `usePolling` on `/api/futures/positions` and `/orders` (3 s), `config` fetched once,
  `reload()`; `lib/futuresMath.js` mirrors the backend formulas for previews (server is authoritative).
- **Portfolio page**: a "Futures" summary row: margin in use, unrealized PnL, equity (§4). No new page.
- Liquidation/TP/SL notice: on poll, a position that left `open` since the last poll shows a toast/message
  ("BTC long liquidated at 90.36"). Socket push is skipped; add when 3 s polling feels late.
- No dead controls: every button above calls an endpoint in §5; nothing renders that the backend does not support.

## 7. Test plan

Backend (jest, in-memory fakes in the `limit-orders.test.js` style: conditional updates check+apply in one tick):
- `futuresMath.test.js`: V1–V5 exact cents; tier caps (BTC 50x at $50k, 20x at $50,001; ALT 20x); fee min 1c;
  liq strictly between 0 and entry for long and above entry for short at every allowed lev.
- `futuresLedger.test.js`: open/add/close/cancel/fill happy paths with balance deltas; insufficient funds rolls back and
  voids; E11000 on `activeKey` retries as add; **crash injection**: make each of steps 2–6 throw once, then
  `recoverAll()` -> balance changed exactly once, op done or rolled_back, no lock left; marker never unset before
  done; 10 failed recoveries -> 'error' and target stays locked.
- `riskEngine.test.js`: long/short liquidation at the boundary, SL then TP precedence, liq beats SL, stale/no price ->
  no action, limit fill at limit price, user close racing TP in the same tick -> one settlement, pass non-overlap
  (`runOnce` returns same promise), `stop()` drains, hold/release reconcile.
- `futures-api.test.js`: every §5 error code, validation 422s, ownership 404s, PATCH tp/sl bounds, partial close min.
- Regression: full `npm test` in backend; spot suites unchanged and green.

Frontend (react-scripts test): `futuresMath.test.js` same V1–V5; `LeverageControl.test.js` (presets filtered by max,
clamp); `TpSlFields.test.js` (bounds per side, % <-> price); `PositionsTable.test.js` (renders, PnL sign, close and
edit callbacks, busy disables); `OrderCard.test.js` (switch shows TradeForm / FuturesForm, submit disabled reasons).
Existing `TradeForm.test.js` untouched and green. Manual: open/close each side on BTC, watch a 50x position liquidate.

## 8. Work packages

The contract above (§1 field names, §3 ledger API, §5 routes, §6 props) is frozen; packages code against it, so all
of B1–B5 and F1–F5 can start together. Each package: only its files, its tests green, plus full `npm test` in its
half. Review of every package by an Opus pass (money/concurrency first).

| ID | Package | Files (create unless noted) | Model |
|---|---|---|---|
| B1 | Futures maths | `backend/services/futuresMath.js`, `backend/tests/futuresMath.test.js`, edit `services/tradeMath.js` (export `notionalCents` only) | Haiku (pure, vectors given) |
| B2 | Models | `models/Position.js`, `models/FuturesOrder.js`, `models/FuturesOp.js`, edit `models/User.js` (add `futuresOps`) | Haiku |
| B3 | Ledger (op executor + recovery) | `services/futuresLedger.js`, `tests/futuresLedger.test.js` | Sonnet (hardest; crash tests) |
| B4 | Risk engine + wiring | `services/riskEngine.js`, `tests/riskEngine.test.js`, edit `server.js` (start/stop/drain/recoverAll) | Sonnet (stubs `futuresLedger.run`) |
| B5 | API | `controllers/futuresController.js`, `routes/futuresRoutes.js`, edit `middleware/validator.js` (add rules), edit `server.js` (mount `/api/futures`), `tests/futures-api.test.js` | Sonnet (stubs ledger) |
| F1 | Client maths + data hook | `frontend/src/lib/futuresMath.js` (+test), `frontend/src/lib/useFutures.js` | Haiku |
| F2 | LeverageControl | `components/trade/LeverageControl.jsx` (+test) | Haiku |
| F3 | TpSlFields | `components/trade/TpSlFields.jsx` (+test) | Sonnet (validation, % mode) |
| F4 | Order card | `components/trade/OrderCard.jsx`, `components/trade/FuturesForm.jsx` (+`OrderCard.test.js`), edit `pages/Trade.js` (render OrderCard, futures submit handler, futures orders into BottomStrip) | Sonnet |
| F5 | Positions + strip + portfolio | `components/trade/PositionsTable.jsx` (+test), edit `components/trade/BottomStrip.jsx` (tabs per §6), edit `pages/Portfolio.js` (futures summary) | Sonnet |

Shared-file edits: `server.js` is touched by B4 (service lines) and B5 (one `app.use` line) — different hunks, merge
B5 after B4. `pages/Trade.js` is F4 only; F5 receives futures data through new BottomStrip props
(`futures={ {positions, closed, orders, onClose, onEditTpSl, onCancelOrder, busyId} }`) that F4 passes.
Order of merge: B1, B2 -> B3 -> B4, B5 -> F1..F5 -> end-to-end manual check.

Out of scope (add when asked): funding, cross margin, leverage change on open positions, reduce-only limit exits,
trailing stops, socket push of position events, op-journal TTL.
