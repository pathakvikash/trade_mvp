const { quote, avgCost, MIN_NOTIONAL_CENTS } = require('../services/tradeMath');

const t = (type, amount, priceAtTrade, n) => ({ type, amount, priceAtTrade, date: new Date(n), _id: String(n) });

test('avgCost: close and reopen resets the basis', () => {
    expect(avgCost([t('buy', 1, 100, 1), t('sell', 1, 150, 2), t('buy', 1, 200, 3)])).toBe(200);
});

test('avgCost: partial sells keep the average; trades are ordered by date, not input order', () => {
    expect(avgCost([t('buy', 2, 100, 1), t('buy', 2, 200, 2), t('sell', 1, 500, 3)])).toBe(150);
    expect(avgCost([t('sell', 1, 500, 3), t('buy', 2, 200, 2), t('buy', 2, 100, 1)])).toBe(150);
    expect(avgCost([])).toBe(0);
});

test('avgCost: float dust after a full sell counts as closed', () => {
    expect(avgCost([t('buy', 0.1, 100, 1), t('buy', 0.2, 100, 2), t('sell', 0.3, 100, 3), t('buy', 1, 50, 4)])).toBe(50);
});

test('quote: fee is at least 1 cent and rounds up; buy rounds up, sell rounds down', () => {
    expect(quote('buy', 2, 100)).toEqual({ notional: 20000, fee: 20, total: 20020 });
    expect(quote('sell', 2, 100)).toEqual({ notional: 20000, fee: 20, total: 19980 });
    expect(quote('buy', 1, 5.001)).toMatchObject({ notional: 500.1, fee: 1, total: 502 }); // ceil(500.1 + 1)
    expect(quote('sell', 1, 5.001).total).toBe(499); // floor(500.1 - 1)
    expect(MIN_NOTIONAL_CENTS).toBe(500);
});

test('property: a buy then sell at an unchanged price never increases the balance', () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < 20000; i++) {
        const price = Math.round(rnd() ** 4 * 1e6 * 1e6) / 1e6 + 1e-6; // 1e-6 .. 1e6, many odd decimals
        const amount = Math.round((5 / price + rnd() * 3 * (rnd() < 0.5 ? 1 : 100)) * 1e8) / 1e8; // >= ~$5 notional, 8 dp
        const buy = quote('buy', amount, price);
        const sell = quote('sell', amount, price);
        if (buy.notional < MIN_NOTIONAL_CENTS) continue;
        expect(Number.isInteger(buy.total) && Number.isInteger(sell.total) && Number.isInteger(buy.fee)).toBe(true);
        expect(sell.total).toBeLessThan(buy.total); // strictly loses at least the fees
        expect(buy.fee).toBeGreaterThanOrEqual(1);
    }
});
