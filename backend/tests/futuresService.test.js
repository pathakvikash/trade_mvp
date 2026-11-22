const { EventEmitter } = require('events');
const svc = require('../services/futuresService');

jest.spyOn(require('../services/futuresRest'), 'isKnownSymbol').mockResolvedValue(true); // no network in unit tests

const { connection, onConnection, subs, conns, setStopped } = svc._test;

function fakeConn(name) {
    const sent = [];
    const ws = new EventEmitter();
    ws.readyState = 1; // OPEN
    ws.send = (m) => sent.push(JSON.parse(m));
    ws.terminate = jest.fn();
    const c = connection(name, () => ws);
    setStopped(false);
    c.open();
    ws.emit('open');
    return { c, ws, sent };
}

function fakeSocket(id) {
    const handlers = {};
    const socket = {
        id, emitted: [],
        on: (ev, fn) => { handlers[ev] = fn; },
        join: jest.fn(), leave: jest.fn(),
        emit: (ev, p) => socket.emitted.push([ev, p]),
    };
    onConnection(socket);
    return { socket, fire: (ev, p) => handlers[ev](p) } // returns the handler's promise;
}

let market, pub;
beforeEach(() => {
    subs.clear();
    market = fakeConn('market');
    pub = fakeConn('public');
    conns.market = market.c;
    conns.public = pub.c;
});
afterEach(() => { market.c.close(); pub.c.close(); setStopped(true); });

const flush = () => { market.c.flush(); pub.c.flush(); };

test('two subscribes from one socket = one upstream sub; last leave = one unsub', async () => {
    const a = fakeSocket('a');
    await a.fire('futures:subscribe', { symbol: 'BTCUSDT' });
    await a.fire('futures:subscribe', { symbol: 'BTCUSDT' });
    const b = fakeSocket('b');
    await b.fire('futures:subscribe', { symbol: 'BTCUSDT' });
    flush();
    expect(market.sent).toHaveLength(1);
    expect(market.sent[0]).toMatchObject({ method: 'SUBSCRIBE', params: ['btcusdt@kline_1m', 'btcusdt@markPrice@1s', 'btcusdt@aggTrade'] });
    expect(pub.sent[0].params).toEqual(['btcusdt@depth20@100ms']);

    a.fire('futures:unsubscribe', { symbol: 'BTCUSDT' });
    flush();
    expect(market.sent).toHaveLength(1); // b still in room
    b.fire('futures:unsubscribe', { symbol: 'BTCUSDT' });
    flush();
    expect(market.sent[1]).toMatchObject({ method: 'UNSUBSCRIBE' });
});

test('disconnect cleans up', async () => {
    const a = fakeSocket('a');
    await a.fire('futures:subscribe', { symbol: 'ETHUSDT' });
    flush();
    a.fire('disconnect');
    flush();
    expect(subs.size).toBe(0);
    expect(market.sent[1].method).toBe('UNSUBSCRIBE');
});

test('sub then unsub inside one batch nets out to no frame', async () => {
    const a = fakeSocket('a');
    await a.fire('futures:subscribe', { symbol: 'ETHUSDT' });
    a.fire('futures:unsubscribe', { symbol: 'ETHUSDT' });
    flush();
    expect(market.sent).toHaveLength(0);
});

test('per-socket cap of 3 symbols is enforced with futures:error', async () => {
    const a = fakeSocket('a');
    for (const symbol of ['AAUSDT', 'BBUSDT', 'CCUSDT', 'DDUSDT']) await a.fire('futures:subscribe', { symbol });
    expect(subs.has('DDUSDT')).toBe(false);
    expect(a.socket.emitted).toEqual([['futures:error', expect.any(Object)]]);
});

test('total cap of 50 symbols', async () => {
    for (let i = 0; i < 50; i++) subs.set(`X${i}USDT`, new Set(['other']));
    const a = fakeSocket('a');
    await a.fire('futures:subscribe', { symbol: 'NEWUSDT' });
    expect(subs.has('NEWUSDT')).toBe(false);
    expect(a.socket.emitted[0][0]).toBe('futures:error');
});

test('watchdog terminates idle market connection', async () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 61000);
    market.c.watchdog();
    pub.c.watchdog(); // public has no streams: left alone
    spy.mockRestore();
    expect(market.ws.terminate).toHaveBeenCalledTimes(1);
    expect(pub.ws.terminate).not.toHaveBeenCalled();
});

test('aggTrade is batched per symbol, capped at the latest 50, and only emitted to the room', async () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    svc._test.setIo({ to });
    const a = fakeSocket('a');
    await a.fire('futures:subscribe', { symbol: 'BTCUSDT' });
    for (let i = 1; i <= 60; i++) svc._test.onMessage('btcusdt@aggTrade', { e: 'aggTrade', s: 'BTCUSDT', p: '100', q: String(i), m: i % 2 === 0, T: i });
    svc._test.onMessage('ethusdt@aggTrade', { e: 'aggTrade', s: 'ETHUSDT', p: '1', q: '1', m: true, T: 1 }); // nobody subscribed
    svc._test.flushTrades();
    svc._test.setIo(null);
    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith('fut:BTCUSDT');
    const [ev, payload] = emit.mock.calls[0];
    expect(ev).toBe('futures:trades');
    expect(payload.trades).toHaveLength(50);
    expect(payload.trades[0].qty).toBe(11);
    expect(payload.trades[49]).toEqual({ price: 100, qty: 60, side: 'sell', ts: 60 });
});

test('unsubscribe while isKnownSymbol is pending cancels the join (no leaked room or upstream sub)', async () => {
    const rest = require('../services/futuresRest');
    let release;
    rest.isKnownSymbol.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const a = fakeSocket('a');
    const slow = a.fire('futures:subscribe', { symbol: 'BTCUSDT' });
    a.fire('futures:unsubscribe', { symbol: 'BTCUSDT' });
    await a.fire('futures:subscribe', { symbol: 'ETHUSDT' });
    release(true);
    await slow;
    flush();
    expect(a.socket.join.mock.calls).toEqual([['fut:ETHUSDT']]);
    expect([...subs.entries()].filter(([, s]) => s.has('a')).map(([k]) => k)).toEqual(['ETHUSDT']);
    expect(market.sent.flatMap((m) => m.params).some((p) => p.startsWith('btcusdt'))).toBe(false);
});

test('all-market array streams fill futuresRest live caches and never touch the mark/money path', async () => {
    const rest = require('../services/futuresRest');
    const axios = require('axios');
    rest._test.reset();
    svc._test.onMessage('!markPrice@arr', [{ s: 'BTCUSDT', p: '100', i: '99', r: '0.0001', T: 5 }]);
    svc._test.onMessage('!miniTicker@arr', [{ s: 'BTCUSDT', c: '100', o: '90', h: '101', l: '89', q: '1000', E: 1 }]);
    expect(svc.getMark('BTCUSDT')).toBeNull(); // futuresService.marks untouched: fills still need a subscribed/held mark
    const get = jest.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('418'), { response: { status: 418, headers: {} } }));
    try {
        expect((await rest.markPrice('BTCUSDT')).markPrice).toBe(100); // cache is fed; reachable only as the REST fallback
    } finally {
        get.mockRestore();
        rest._test.reset();
    }
});
