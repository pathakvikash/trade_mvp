// Curated view-only markets served from Yahoo (analytics only; never prices, fills or trading symbols).
// `symbol` is the only identifier a client may send (display form, ^[A-Z0-9&-]{1,20}$); `yahoo` stays server side.
// Verified live on Yahoo v8 chart 2026-11-24. TATAMOTORS.NS is delisted after the demerger: use TMPV / TMCV.
const NSE = { exchange: 'NSE', currency: 'INR' };
const stock = (symbol, name) => ({ symbol, name, category: 'stock', yahoo: `${symbol}.NS`, ...NSE });
const index = (symbol, name, yahoo) => ({ symbol, name, category: 'index', yahoo, ...NSE });
const commodity = (symbol, name, yahoo, exchange) => ({ symbol, name, category: 'commodity', yahoo, exchange, currency: 'USD' });
const fx = (symbol, name, yahoo, currency) => ({ symbol, name, category: 'currency', yahoo, exchange: 'FX', currency });

const INSTRUMENTS = [
    stock('RELIANCE', 'Reliance Industries'),
    stock('TCS', 'Tata Consultancy Services'),
    stock('INFY', 'Infosys'),
    stock('HDFCBANK', 'HDFC Bank'),
    stock('ICICIBANK', 'ICICI Bank'),
    // Tata group
    stock('TATASTEEL', 'Tata Steel'),
    stock('TATAPOWER', 'Tata Power'),
    stock('TITAN', 'Titan Company'),
    stock('TMPV', 'Tata Motors Passenger Vehicles'),
    stock('TMCV', 'Tata Motors Commercial Vehicles'),
    // Aditya Birla group
    stock('GRASIM', 'Grasim Industries'),
    stock('HINDALCO', 'Hindalco Industries'),
    stock('ULTRACEMCO', 'UltraTech Cement'),
    stock('ABCAPITAL', 'Aditya Birla Capital'),
    stock('ABFRL', 'Aditya Birla Fashion and Retail'),
    stock('IDEA', 'Vodafone Idea'),
    index('NIFTY50', 'NIFTY 50', '^NSEI'),
    index('BANKNIFTY', 'BANK NIFTY', '^NSEBANK'),
    index('NIFTYIT', 'NIFTY IT', '^CNXIT'),
    commodity('GOLD', 'Gold (COMEX futures)', 'GC=F', 'COMEX'),
    commodity('SILVER', 'Silver (COMEX futures)', 'SI=F', 'COMEX'),
    commodity('CRUDEOIL', 'Crude Oil WTI (NYMEX futures)', 'CL=F', 'NYMEX'),
    commodity('BRENT', 'Brent Crude (futures)', 'BZ=F', 'NYMEX'),
    fx('USDINR', 'USD/INR', 'USDINR=X', 'INR'),
    fx('EURINR', 'EUR/INR', 'EURINR=X', 'INR'),
    fx('GBPINR', 'GBP/INR', 'GBPINR=X', 'INR'),
    fx('EURUSD', 'EUR/USD', 'EURUSD=X', 'USD'),
];

const CATEGORIES = ['stock', 'index', 'commodity', 'currency'];
const BY_SYMBOL = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
const SYMBOL_RE = /^[A-Z0-9&-]{1,20}$/;

// Allow-list lookup of a client-supplied display symbol; null for anything else (raw Yahoo tickers fail the pattern).
const find = (raw) => {
    const s = String(raw || '').toUpperCase();
    return SYMBOL_RE.test(s) ? BY_SYMBOL.get(s) || null : null;
};
const list = (category) => (category ? INSTRUMENTS.filter((i) => i.category === category) : INSTRUMENTS);

module.exports = { INSTRUMENTS, CATEGORIES, SYMBOL_RE, find, list };
