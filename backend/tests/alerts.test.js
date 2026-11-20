const svc = require('../services/futuresService');
const alerts = require('../services/alertService');

const { shouldTrigger } = alerts;
const now = 1e12;
const base = { active: true, op: 'above', value: 100, cooldownMin: 15, lastTriggeredAt: null };

test('shouldTrigger: above / below', () => {
    expect(shouldTrigger(base, 101, now)).toBe(true);
    expect(shouldTrigger(base, 100, now)).toBe(false);
    expect(shouldTrigger({ ...base, op: 'below' }, 99, now)).toBe(true);
    expect(shouldTrigger({ ...base, op: 'below' }, 101, now)).toBe(false);
});

test('shouldTrigger: cooldown, inactive, null/NaN observed', () => {
    expect(shouldTrigger({ ...base, lastTriggeredAt: new Date(now - 14 * 60000) }, 101, now)).toBe(false);
    expect(shouldTrigger({ ...base, lastTriggeredAt: new Date(now - 16 * 60000) }, 101, now)).toBe(true);
    expect(shouldTrigger({ ...base, active: false }, 101, now)).toBe(false);
    expect(shouldTrigger(base, null, now)).toBe(false);
    expect(shouldTrigger(base, NaN, now)).toBe(false);
});

test('observe: price, funding as percent, liq 5m sum; stale mark -> null', () => {
    const { observe } = alerts._test;
    svc._test.marks.set('BTCUSDT', { markPrice: 50000, fundingRate: 0.0001, ts: Date.now() });
    expect(observe({ symbol: 'BTCUSDT', metric: 'price' }, Date.now())).toBe(50000);
    expect(observe({ symbol: 'BTCUSDT', metric: 'funding' }, Date.now())).toBeCloseTo(0.01);
    expect(observe({ symbol: 'BTCUSDT', metric: 'price' }, Date.now() + 60000)).toBeNull();
    expect(observe({ symbol: 'NOPEUSDT', metric: 'price' }, Date.now())).toBeNull();
    svc._test.marks.clear();
});

describe('hold / release', () => {
    let sent;
    beforeEach(() => {
        sent = [];
        const rec = (m) => (l) => sent.push([m, ...l]);
        svc._test.conns.market = { sub: rec('sub'), unsub: rec('unsub') };
        svc._test.conns.public = { sub() {}, unsub() {} };
        svc._test.subs.clear();
        svc._test.holds.clear();
    });
    afterEach(() => { svc._test.holds.clear(); svc._test.subs.clear(); });

    test('ref-counted: one upstream sub, unsub only on last release', () => {
        expect(svc.hold('BTCUSDT')).toBe(true);
        expect(svc.hold('BTCUSDT')).toBe(true);
        expect(sent).toEqual([['sub', 'btcusdt@markPrice@1s']]);
        svc.release('BTCUSDT');
        expect(sent).toHaveLength(1);
        svc.release('BTCUSDT');
        expect(sent[1]).toEqual(['unsub', 'btcusdt@markPrice@1s']);
        svc.release('BTCUSDT'); // extra release is a no-op
        expect(sent).toHaveLength(2);
    });

    test('respects the global cap and rejects invalid symbols', () => {
        for (let i = 0; i < 50; i++) svc._test.subs.set(`X${i}USDT`, new Set(['s']));
        expect(svc.hold('NEWUSDT')).toBe(false);
        expect(svc.hold('X1USDT')).toBe(true); // already counted
        expect(svc.hold('bad')).toBe(false);
    });

    test('a viewing socket leaving does not drop a held markPrice stream', async () => {
        jest.spyOn(require('../services/futuresRest'), 'isKnownSymbol').mockResolvedValue(true);
        svc.hold('ETHUSDT');
        const handlers = {};
        const socket = { id: 'a', on: (e, f) => { handlers[e] = f; }, join() {}, leave() {}, emit() {} };
        svc._test.onConnection(socket);
        await handlers['futures:subscribe']({ symbol: 'ETHUSDT' });
        sent.length = 0;
        handlers['futures:unsubscribe']({ symbol: 'ETHUSDT' });
        expect(sent).toEqual([['unsub', 'ethusdt@kline_1m', 'ethusdt@aggTrade']]);
    });
});

describe('refresh sequence guard', () => {
    const mongoose = require('mongoose');
    const Alert = require('../models/Alert');
    afterEach(() => { jest.restoreAllMocks(); alerts.stop(); });

    test('an older refresh resolving last cannot resurrect a deleted alert; fired ids are pruned', async () => {
        Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
        const defer = () => { let r; const p = new Promise((x) => { r = x; }); return { p, r }; };
        const first = defer();
        const second = defer();
        const queue = [first, second];
        jest.spyOn(Alert, 'find').mockImplementation(() => ({ lean: () => queue.shift().p }));
        alerts._test.fired.set('gone', 1);
        const r1 = alerts.refresh();
        const r2 = alerts.refresh();
        second.r([]); // newer refresh: alert was deleted
        await r2;
        first.r([{ _id: 'a1', symbol: 'BTCUSDT', metric: 'liq_usd_5m', active: true }]); // stale result arrives last
        await r1;
        expect(alerts._test.getActive()).toEqual([]);
        expect(alerts._test.fired.has('gone')).toBe(false);
        delete mongoose.connection.readyState;
    });
});

test('shouldTrigger: 60s floor since the last fire holds even with cooldown cleared', () => {
    expect(shouldTrigger(base, 101, now, now - 59000)).toBe(false);
    expect(shouldTrigger(base, 101, now, now - 60000)).toBe(true);
    expect(shouldTrigger(base, 101, now, 0)).toBe(true);
});
