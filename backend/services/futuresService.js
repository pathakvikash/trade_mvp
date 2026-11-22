const WebSocket = require('ws');
const logger = require('../config/logger');
const mongoose = require('mongoose');
const Liquidation = require('../models/Liquidation');
const futuresRest = require('./futuresRest');
const { isValidSymbol, normalizeForceOrder, normalizeKline, normalizeAggTrade, summarizeLiquidations } = require('./futuresUtils');

// Binance USDS-M futures splits streams across two endpoints (verified 2026-11-19):
//   /public/stream -> depth;  /market/stream -> kline, markPrice, forceOrder, aggTrade
const BASE = process.env.BINANCE_FUTURES_WS || 'wss://fstream.binance.com';
const MAX_PER_SYMBOL = 5000;
const TRADES_PER_BATCH = 50;
const MAX_AGE_MS = 24 * 3600 * 1000;
const BOOK_MIN_INTERVAL_MS = 250;
const FLUSH_MS = 250;
const IDLE_MS = 60000;
const MAX_SYMBOLS_PER_SOCKET = 3;
const MAX_SYMBOLS_TOTAL = 50;

// In-memory buffer (hot path) mirrored to Mongo (models/Liquidation) and reloaded on start.
const liquidations = new Map(); // symbol -> event[] (oldest first)
const sinceTs = { value: Date.now() };

let ioNs = null;
let stopped = true;
const conns = {}; // 'public' | 'market' -> connection
const subs = new Map(); // symbol -> Set(socket.id)
const holds = new Map(); // symbol -> server-side ref count (alerts); only the markPrice stream
const marks = new Map(); // symbol -> last { markPrice, fundingRate, ts } (any symbol with a markPrice stream)
const lastBook = new Map(); // symbol -> last emit ms
const tradeBuf = new Map(); // symbol -> trades awaiting the next 250ms flush
let tradeTimer = null;

function connection(name, makeWs = (url) => new WebSocket(url)) {
    const streams = new Set();
    const pending = new Map(); // stream -> 'SUBSCRIBE' | 'UNSUBSCRIBE', flushed in batches
    let ws = null;
    let attempt = 0;
    let timer = null;
    let tick = null;
    let lastMsg = Date.now();

    const isOpen = () => ws && ws.readyState === WebSocket.OPEN;
    const send = (method, params) => ws.send(JSON.stringify({ method, params, id: Date.now() }));
    const queue = (list, method, opposite) => list.forEach((st) => {
        if (pending.get(st) === opposite) pending.delete(st); // sub+unsub in one batch nets out
        else pending.set(st, method);
    });
    // Binance allows 10 incoming messages/s per connection: at most one frame per tick
    const flush = () => {
        if (!isOpen() || pending.size === 0) return;
        const method = pending.values().next().value;
        const params = [...pending].filter(([, m]) => m === method).map(([st]) => st);
        params.forEach((st) => pending.delete(st));
        send(method, params);
    };
    let lastPing = 0;
    const watchdog = () => {
        // our own ping every 20s: a pong proves the link is alive even when no data flows
        // (quiet liquidation minute, or a connection with no streams yet)
        if (isOpen() && ws.ping && Date.now() - lastPing > 20000) {
            lastPing = Date.now();
            ws.ping();
        }
        if (!ws || (name !== 'market' && streams.size === 0)) return;
        if (Date.now() - lastMsg > IDLE_MS) {
            logger.warn(`futuresService: ${name} idle > ${IDLE_MS}ms, reconnecting`);
            lastMsg = Date.now();
            ws.terminate();
        }
    };
    const open = () => {
        if (stopped) return;
        if (!tick) {
            tick = setInterval(() => { flush(); watchdog(); }, FLUSH_MS);
            if (tick.unref) tick.unref();
        }
        ws = makeWs(`${BASE}/${name}/stream`);
        lastMsg = Date.now();
        ws.on('open', () => {
            lastMsg = Date.now();
            pending.clear();
            if (streams.size) send('SUBSCRIBE', [...streams]);
            logger.info(`futuresService: ${name} connected, ${streams.size} streams`);
        });
        ws.on('message', (raw) => {
            lastMsg = Date.now();
            attempt = 0; // reset backoff only once the upstream actually talks
            try {
                const m = JSON.parse(raw);
                if (m.error) logger.warn(`futuresService ${name} upstream error ${m.error.code}: ${m.error.msg}`);
                else if (m.stream && m.data) onMessage(m.stream, m.data);
            } catch (e) {
                logger.error('futuresService bad message', e.message);
            }
        });
        ws.on('pong', () => { lastMsg = Date.now(); });
        // ws answers server pings with pongs automatically
        ws.on('error', (e) => logger.error(`futuresService ${name} error: ${e.message}`));
        ws.on('close', () => {
            if (stopped) return;
            const delay = Math.min(30000, 1000 * 2 ** attempt++);
            logger.warn(`futuresService: ${name} closed, reconnecting in ${delay}ms`);
            timer = setTimeout(open, delay);
            if (timer.unref) timer.unref();
        });
    };
    return {
        open,
        flush,
        watchdog,
        sub: (list) => { list.forEach((st) => streams.add(st)); queue(list, 'SUBSCRIBE', 'UNSUBSCRIBE'); },
        unsub: (list) => { list.forEach((st) => streams.delete(st)); queue(list, 'UNSUBSCRIBE', 'SUBSCRIBE'); },
        add: (st) => streams.add(st),
        close: () => { clearTimeout(timer); clearInterval(tick); tick = null; if (ws) ws.terminate(); },
    };
}

const room = (symbol) => `fut:${symbol}`;

function trim(buf) {
    const cutoff = Date.now() - MAX_AGE_MS;
    while (buf.length > MAX_PER_SYMBOL || (buf.length && buf[0].ts < cutoff)) buf.shift();
}

// Batched persistence: events queue here and one insertMany per second writes them. Skipped while Mongo is
// not connected so the queue never grows; bounded at MAX_PENDING (oldest dropped, one warning per overflow).
const MAX_PENDING = 5000;
const pending = [];
let pendingWarned = false;
let persistTimer = null;
function persist(ev) {
    if (mongoose.connection.readyState !== 1) return;
    if (pending.length >= MAX_PENDING) {
        pending.shift();
        if (!pendingWarned) { pendingWarned = true; logger.warn(`futuresService: liquidation write queue over ${MAX_PENDING}, dropping oldest`); }
    }
    pending.push(ev);
}
function flushPersist() {
    if (!pending.length || mongoose.connection.readyState !== 1) return;
    const batch = pending.splice(0);
    pendingWarned = false;
    Liquidation.insertMany(batch, { ordered: false }).catch((e) => logger.error(`futuresService liquidation persist failed: ${e.message}`));
}

async function loadHistory() {
    // an older collection may carry the previous TTL/compound index; reconcile with the schema, never fatal
    try { await Liquidation.syncIndexes(); } catch (e) { logger.error(`futuresService: liquidation syncIndexes failed: ${e.message}`); }
    try {
        const rows = await Liquidation.find({ ts: { $gte: Date.now() - MAX_AGE_MS } })
            .sort({ ts: 1 }).select('-_id symbol side price qty usd ts').lean();
        if (!rows.length) return;
        const live = new Map();
        for (const [sym, buf] of liquidations) live.set(sym, new Set(buf.map((e) => `${e.ts}|${e.price}|${e.qty}|${e.side}`)));
        for (const ev of rows) {
            const seen = live.get(ev.symbol);
            if (seen && seen.has(`${ev.ts}|${ev.price}|${ev.qty}|${ev.side}`)) continue; // already buffered live
            const buf = liquidations.get(ev.symbol) || [];
            buf.push(ev);
            liquidations.set(ev.symbol, buf);
        }
        // loaded rows may interleave with events that arrived while loading
        for (const buf of liquidations.values()) { buf.sort((a, b) => a.ts - b.ts); trim(buf); }
        sinceTs.value = Math.min(sinceTs.value, rows[0].ts);
        logger.info(`futuresService: loaded ${rows.length} liquidations from Mongo`);
    } catch (e) {
        logger.error(`futuresService: liquidation history load failed: ${e.message}`);
    }
}

function flushTrades() {
    for (const [symbol, trades] of tradeBuf) {
        if (ioNs) ioNs.to(room(symbol)).emit('futures:trades', { symbol, trades: trades.slice(-TRADES_PER_BATCH) });
    }
    tradeBuf.clear();
}

function onMessage(stream, d) {
    if (stream === '!forceOrder@arr') {
        const ev = normalizeForceOrder(d);
        if (!ev) return;
        const buf = liquidations.get(ev.symbol) || [];
        buf.push(ev);
        trim(buf);
        liquidations.set(ev.symbol, buf);
        persist(ev);
        if (ioNs) ioNs.to(room(ev.symbol)).emit('futures:liquidation', ev);
        return;
    }
    // arrays carry no `.s`: route them before the per-symbol access
    if (stream === '!miniTicker@arr') return futuresRest.ingestTickers(d);
    if (stream === '!markPrice@arr') return futuresRest.ingestMarks(d);
    const symbol = d.s;
    if (!symbol) return;
    if (d.e === 'aggTrade') {
        const t = normalizeAggTrade(d);
        if (!t || !subs.has(symbol)) return;
        const b = tradeBuf.get(symbol) || [];
        b.push(t);
        if (b.length > TRADES_PER_BATCH) b.shift(); // only the latest 50 are ever sent
        tradeBuf.set(symbol, b);
    } else if (d.e === 'kline') {
        if (ioNs) ioNs.to(room(symbol)).emit('futures:kline', { symbol, ...normalizeKline(d.k) });
    } else if (d.e === 'markPriceUpdate') {
        marks.set(symbol, { markPrice: parseFloat(d.p), fundingRate: parseFloat(d.r), ts: Date.now() });
        if (ioNs) ioNs.to(room(symbol)).emit('futures:mark', {
            symbol,
            markPrice: parseFloat(d.p),
            indexPrice: parseFloat(d.i),
            fundingRate: parseFloat(d.r),
            nextFundingTime: d.T,
        });
    } else if (d.e === 'depthUpdate') {
        const now = Date.now();
        // ponytail: leading-edge throttle drops intermediate frames; fine at 10 fps upstream
        if (now - (lastBook.get(symbol) || 0) < BOOK_MIN_INTERVAL_MS) return;
        lastBook.set(symbol, now);
        if (ioNs) ioNs.to(room(symbol)).emit('futures:book', { symbol, bids: d.b, asks: d.a, ts: d.T });
    }
}

const streamsFor = (sym) => {
    const l = sym.toLowerCase();
    return { market: [`${l}@kline_1m`, `${l}@markPrice@1s`, `${l}@aggTrade`], pub: [`${l}@depth20@100ms`] };
};

function leave(socket, symbol) {
    const set = subs.get(symbol);
    if (!set || !set.delete(socket.id)) return;
    socket.leave(room(symbol));
    if (set.size === 0) {
        subs.delete(symbol);
        lastBook.delete(symbol);
        tradeBuf.delete(symbol);
        const s = streamsFor(symbol);
        // a server-side hold (alerts) keeps the markPrice stream alive
        conns.market.unsub(holds.has(symbol) ? s.market.filter((x) => !x.includes('@markPrice')) : s.market);
        conns.public.unsub(s.pub);
        if (!holds.has(symbol)) marks.delete(symbol);
    }
}

const totalSymbols = () => new Set([...subs.keys(), ...holds.keys()]).size;
const markStream = (sym) => `${sym.toLowerCase()}@markPrice@1s`;

// Ref-counted server-side subscription to a symbol's mark price / funding. Returns false when the
// global symbol cap would be exceeded (or the symbol is invalid); only a true return must be released.
function hold(symbol) {
    if (!isValidSymbol(symbol)) return false;
    const n = holds.get(symbol);
    if (n) { holds.set(symbol, n + 1); return true; }
    if (!subs.has(symbol)) {
        if (totalSymbols() >= MAX_SYMBOLS_TOTAL) return false;
        if (conns.market) conns.market.sub([markStream(symbol)]);
    }
    holds.set(symbol, 1);
    return true;
}

function release(symbol) {
    const n = holds.get(symbol);
    if (!n) return;
    if (n > 1) return holds.set(symbol, n - 1);
    holds.delete(symbol);
    if (!subs.has(symbol)) {
        if (conns.market) conns.market.unsub([markStream(symbol)]);
        marks.delete(symbol);
    }
}

const getMark = (symbol) => marks.get(symbol) || null;

function onConnection(socket) {
    const wanted = new Set(); // symbols the client still wants; an unsubscribe/disconnect during the async check cancels the join
    socket.on('futures:subscribe', async (payload) => {
        const symbol = payload && payload.symbol;
        if (!isValidSymbol(symbol)) return socket.emit('futures:error', { message: 'invalid symbol' });
        wanted.add(symbol);
        if (!(await futuresRest.isKnownSymbol(symbol))) return socket.emit('futures:error', { message: `No perpetual futures market for ${symbol}` });
        if (socket.disconnected || !wanted.has(symbol)) return; // left or unsubscribed while we were checking
        let set = subs.get(symbol);
        if (set && set.has(socket.id)) return;
        const mine = [...subs.values()].filter((x) => x.has(socket.id)).length;
        if (mine >= MAX_SYMBOLS_PER_SOCKET) return socket.emit('futures:error', { message: 'too many symbols for this connection' });
        if (!set && !holds.has(symbol) && totalSymbols() >= MAX_SYMBOLS_TOTAL) return socket.emit('futures:error', { message: 'server symbol limit reached' });
        if (!set) {
            set = new Set();
            subs.set(symbol, set);
        }
        const first = set.size === 0;
        set.add(socket.id);
        socket.join(room(symbol));
        if (first) {
            const s = streamsFor(symbol);
            conns.market.sub(s.market);
            conns.public.sub(s.pub);
        }
    });
    socket.on('futures:unsubscribe', (payload) => {
        if (payload && isValidSymbol(payload.symbol)) { wanted.delete(payload.symbol); leave(socket, payload.symbol); }
    });
    socket.on('disconnect', () => { wanted.clear(); [...subs.keys()].forEach((sym) => leave(socket, sym)); });
}

function start(ns) {
    ioNs = ns;
    stopped = false;
    sinceTs.value = Date.now();
    conns.public = connection('public');
    conns.market = connection('market');
    conns.market.add('!forceOrder@arr');
    // all-market snapshots feed futuresRest's fallbacks when REST is IP-blocked (market endpoint, like forceOrder)
    conns.market.add('!miniTicker@arr');
    conns.market.add('!markPrice@arr');
    ns.on('connection', onConnection);
    conns.public.open();
    conns.market.open();
    tradeTimer = setInterval(flushTrades, FLUSH_MS);
    if (tradeTimer.unref) tradeTimer.unref();
    persistTimer = setInterval(flushPersist, 1000);
    if (persistTimer.unref) persistTimer.unref();
    // server.js starts us before mongoose.connect resolves: load now if up, else once connected
    if (mongoose.connection.readyState === 1) loadHistory();
    else mongoose.connection.once('connected', loadHistory);
    logger.info('futuresService started');
}

function stop() {
    stopped = true;
    clearInterval(tradeTimer);
    clearInterval(persistTimer);
    flushPersist();
    tradeBuf.clear();
    Object.values(conns).forEach((c) => c.close());
    subs.clear();
    holds.clear();
    marks.clear();
    ioNs = null;
    logger.info('futuresService stopped');
}

const getLiquidations = (symbol) => ({ since: sinceTs.value, events: liquidations.get(symbol) || [] });
const getLiquidationSummary = () => ({ since: sinceTs.value, ...summarizeLiquidations(liquidations.values()) });

module.exports = { start, stop, hold, release, getMark, getLiquidations, getLiquidationSummary, _test: { flushPersist, pending, holds, marks, connection, onConnection, subs, conns, onMessage, flushTrades, setIo: (v) => { ioNs = v; }, setStopped: (v) => { stopped = v; } } };
