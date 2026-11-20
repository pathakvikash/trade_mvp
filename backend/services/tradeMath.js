// Pure money maths for paper trades. All order amounts are integer cents; the house never loses a cent to rounding.
const FEE_DIVISOR = 1000; // 0.1% fee
const MIN_NOTIONAL_CENTS = 500; // $5
const DUST = 1e-8; // holdings below this are zero

const round8 = (x) => Math.round(x * 1e8) / 1e8;

// notional in cents for amount * price. Rounded to 6 dp first so float noise (499.99999999) cannot flip a ceil/floor.
const notionalCents = (amount, price) => Math.round(amount * price * 100 * 1e6) / 1e6;

// fee >= 1 cent, rounded up. ceil(n / 1000) is exact when n is a whole number of cents and safe otherwise.
const feeCents = (notional) => Math.max(1, Math.ceil(notional / FEE_DIVISOR));

// -> { notional, fee, total } in cents (integers). buy: total = ceil(notional + fee); sell: total = floor(notional - fee).
// A round trip at one price therefore always loses at least the two fees.
function quote(type, amount, price) {
  const n = notionalCents(amount, price);
  const fee = feeCents(n);
  return { notional: n, fee, total: type === 'buy' ? Math.ceil(n + fee) : Math.floor(n - fee) };
}

// Average cost of what is still held, walking the trades oldest first: buys add to the cost basis, sells remove it
// proportionally, and a position that reaches zero starts over. trades: [{ type, amount, priceAtTrade, date, _id }].
function avgCost(trades) {
  const ordered = [...trades].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a._id).localeCompare(String(b._id)));
  let qty = 0;
  let cost = 0;
  for (const t of ordered) {
    if (t.type === 'buy') {
      qty += t.amount;
      cost += t.amount * t.priceAtTrade;
    } else if (qty > 0) {
      const sold = Math.min(t.amount, qty);
      cost -= (cost / qty) * sold;
      qty -= sold;
    }
    if (qty < DUST) qty = cost = 0;
  }
  return qty > 0 ? cost / qty : 0;
}

module.exports = { MIN_NOTIONAL_CENTS, DUST, round8, quote, avgCost, notionalCents };
