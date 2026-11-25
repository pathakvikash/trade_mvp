// Docs page content as plain data (rendered by pages/Docs.js). Honest by rule (CLAUDE.md rule 8):
// paper trading only, liquidation map/heatmap are estimates, the liquidation feed is sampled, no invented numbers.
// Every figure below is checked against code (see the table in pages/Docs.test.js for file:line sources):
// PAPER_BALANCE (backend/models/User.js), spot fee/min/open orders (context/DOMAIN.md, backend/services/tradeMath.js),
// futures fee/leverage/tiers (backend/services/futuresMath.js), heatmap constants (backend/services/futuresUtils.js),
// X-Data-Source values and fallback chains (context/GOTCHAS.md, backend/services/marketData/index.js),
// AI and strategy limits (backend/services/ai/aiAccess.js, backend/routes/strategyRoutes.js, context/DECISIONS.md).
// Section shape: { id, title, paragraphs, bullets?, table?: {head, rows}, terms?: [[name, text]], diagram?: 'data' }.

export const DOCS_SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting started',
    paragraphs: [
      'Create an account with an email and password, or with Google where the sign-in page offers it. No card and no deposit are needed.',
      'Every new account starts with a paper balance of $100,000 in simulated USD. This is the only balance in the app. You cannot deposit, withdraw or convert real money.',
    ],
    bullets: [
      'Markets, Stocks and Docs are public. Dashboard, Trade, Derivatives, Liquidations, Portfolio and Settings need an account.',
      'Register, then open Trade to place your first order.',
      'Portfolio shows your cash, spot holdings, futures positions and history.',
      'Settings has Profile, AI & model, Preferences and Security. Preferences includes a reduce-motion option.',
    ],
  },
  {
    id: 'spot',
    title: 'Spot trading',
    paragraphs: [
      'Spot orders buy or sell a coin at its current price. Market orders fill immediately at the server price, never at a price from another website.',
      'Each spot trade pays a 0.1% fee on its value. Fees round up, so a round trip at one price always loses at least the two fees.',
    ],
    bullets: [
      'Limit orders reserve the funds when you place them: for a buy, the USD including the fee; for a sell, the coins.',
      'The matcher checks open limit orders about every 2 seconds. A limit order fills at its own limit price once the server price reaches it.',
      'You can have at most 20 open limit orders at a time.',
      'The minimum order value is $5.',
    ],
  },
  {
    id: 'futures',
    title: 'Futures trading',
    paragraphs: [
      'Futures are simulated USDT-margined perpetual contracts with isolated margin. You choose a size, a leverage and a side (long or short). Margin comes out of the same paper balance.',
      'Leverage is a whole number from 1x to 50x. The cap depends on the symbol and on the position size: BTC and ETH allow up to 50x, other symbols up to 20x, and larger positions are held to a lower cap and a higher maintenance margin rate, as in the table.',
      'Opening, adding to or closing a position pays a 0.05% taker fee on its value. A liquidation charges no fee, but the whole margin of that position is lost.',
    ],
    table: {
      caption: 'Position size tiers',
      head: ['Position value up to', 'Max leverage', 'Maintenance margin rate'],
      rows: [
        ['$50,000', '50x', '0.4%'],
        ['$250,000', '20x', '0.5%'],
        ['$1,000,000', '10x', '1.0%'],
        ['$5,000,000', '5x', '2.5%'],
        ['Above $5,000,000', '2x', '5.0%'],
      ],
    },
    bullets: [
      'Take-profit (TP) and stop-loss (SL) can be set when you open a position and changed later. The risk engine checks them about every second.',
      'A long is liquidated when the mark price falls to its liquidation price, and a short when it rises to its liquidation price. That price depends on the entry, the size, the margin and the maintenance margin rate.',
      'The minimum position value is $5. You can have at most 20 open positions and 20 open futures orders.',
      'Paper futures do not charge or pay funding. The funding rates shown on the market pages are information only.',
      'Fills, marks, liquidations and TP/SL use Binance prices only. Prices from other sources are never used for money.',
    ],
  },
  {
    id: 'heatmap',
    title: 'Liquidation heatmap and map',
    paragraphs: [
      'The liquidation heatmap and map are estimates. They are not exchange data and they do not show real positions, because exchanges do not publish those.',
      'The model treats each rise in open interest as new positions, split 50/50 between longs and shorts. They are spread over an assumed leverage mix from 5x to 125x, entered at the low, typical and high price of the candle, with a 0.4% maintenance margin. A level is dropped once a later candle trades through it. The inputs are public market data and the assumptions are fixed in the code.',
      'The liquidation feed is a sample. Binance publishes at most one liquidation per symbol per second, and our buffer starts when the server starts (plus up to 24 hours reloaded from storage), so the totals shown are lower than the real amounts.',
    ],
    bullets: [
      'Use these views to see where leverage might be concentrated and how it changes, not to predict an exact price.',
      'A newly listed symbol may have partial history. The page labels this; it is not an error.',
    ],
  },
  {
    id: 'derivatives',
    title: 'Derivatives analytics',
    paragraphs: [
      'The Derivatives page shows funding rates, open interest, long/short account ratios, top-trader ratios and taker buy/sell ratios for USDS-M perpetuals. The Liquidations page shows the sampled feed and the estimated map.',
    ],
    bullets: [
      'Funding is shown for information. Paper futures do not pay or charge it.',
      'Open interest is the total size of open contracts. It does not say who holds them or in which direction.',
      'Ratios and open interest from different exchanges are not directly comparable. The page labels the source of each number.',
      'The market overview lists the top 40 perpetuals by trading volume.',
      'The Dashboard card "Movers: trade bias" shows a Long, Short or Wait lean for the top 24h gainer and loser. It is a fixed rule set over the 24h move, funding, open interest, the long/short ratio and the estimated liquidation map, with no AI call. It says Wait when data is missing or the factors disagree. It is analysis for paper trading, not a prediction and not advice.',
    ],
  },
  {
    id: 'real-markets',
    title: 'Real markets',
    paragraphs: [
      'The Stocks page shows NSE-listed stocks with prices in INR. The data comes from Yahoo Finance, which is unofficial, and NSE quotes can lag by about 15 minutes. You can only view it.',
      'Our API also serves a short curated list of indices, commodities (futures) and currency pairs from the same source. The list is fixed in the code; it is not a full market feed.',
    ],
    bullets: [
      'Paper trading for stocks is not available yet. There are no buy or sell controls on that page.',
      'If Yahoo cannot answer, the last good answer may be shown and marked stale for up to 24 hours.',
      'Check the data timestamp before you rely on a price. Nothing on that page is investment advice.',
    ],
  },
  {
    id: 'ai',
    title: 'AI analyst and strategies',
    paragraphs: [
      'The AI analyst answers questions about the markets and can draft an alert or a strategy idea. By default it uses the server\'s own key, which has a daily cap. In Settings, under AI & model, you can instead add your own key for Anthropic, OpenAI, Google Gemini, OpenRouter or any OpenAI-compatible endpoint. Keys are stored encrypted and only the last four characters are shown back.',
      'The AI never places orders and never runs code. A strategy it suggests is only a JSON description. The server checks that description and runs it only when you ask for an evaluation.',
    ],
    bullets: [
      'Limits: 10 AI requests per minute per user. On the server\'s own key, 60 chat requests per day. You can save up to 20 strategies. Saved chats keep the latest 10 conversations of up to 40 messages and expire 30 days after the last message.',
      'A backtest replays a strategy on past candles. It is hypothetical and in-sample: it shows what the rules would have done, not what they will do. Fills happen at the next candle open, and when stop and target are inside the same candle the stop is assumed to hit first.',
      'AI answers can be wrong or out of date. Nothing the AI says is financial advice.',
      'LM Studio (a model running on your own computer) works only on a local setup, not on a hosted server.',
    ],
  },
  {
    id: 'data',
    title: 'How the data works',
    diagram: 'data',
    paragraphs: [
      'Binance USDS-M futures is the first source for prices and derivatives data. If Binance blocks requests from our server, we try other sources in a fixed order for each kind of data (for candles: Binance, Bybit, Bitget, Gate, MEXC, then the Binance spot mirror) and tag the answer with the source it came from.',
      'Each source has its own circuit breaker. After a block or repeated failures it is skipped for a while and then tried once again. Public status, without any addresses, is at GET /api/market/providers.',
    ],
    bullets: [
      'binance-futures: Binance USDS-M REST (the default).',
      'ws: Binance WebSocket streams, used when REST is blocked. Open interest is not included in this mode.',
      'bybit, bitget, gate, mexc: other exchanges, used only when the earlier sources fail. Their numbers differ from Binance, and the page labels them.',
      'spot: the Binance spot mirror, used only for candles. Spot candles differ slightly from futures candles.',
      'yahoo: the delayed, unofficial stock data.',
      'unavailable: no source could answer for that symbol or range right now. On first load the page shows a retry state; if a later refresh fails, the last good numbers stay on screen with a note that the refresh failed and the time they are from.',
      'The liquidation map and heatmap: when Binance futures is blocked, they are rebuilt from Bybit or Gate candles and open interest if the symbol is listed there; otherwise they are unavailable. The page shows a source note saying which exchange the numbers come from.',
    ],
  },
  {
    id: 'patterns',
    title: 'Patterns and how to read them',
    paragraphs: [
      'This section is education, not a signal. None of these patterns predicts price, they often appear without anything following, and a chart that looks like one of them is not a reason to trade. Paperline is a place to practise reading them with paper money.',
    ],
    terms: [
      ['Funding at an extreme', 'A strongly positive funding rate means longs are paying shorts, which tells you the market is leaning long. It describes crowding, not direction: in a strong trend funding can stay extreme for a long time. Compare it with the same symbol\'s own history, not with other coins.'],
      ['Open interest building up', 'Open interest rising while price moves sideways means positions are being added without a clear winner yet. The liquidation heatmap models exactly this: new open interest becomes assumed liquidation levels. Whether those levels matter depends on whether price goes there.'],
      ['Open interest dropping sharply', 'A fast fall in open interest means positions are closing, whether by choice or by force. Check the liquidation feed for the same period, remembering that it is a sample and understates the total.'],
      ['Long/short ratio skew', 'A ratio far from 1 shows how accounts are split, not how much money each side holds, and one large account counts the same as a small one. The account ratio and the top-trader ratio can disagree, and either can be early or late.'],
      ['Liquidation clusters', 'Where the estimated levels stack up, forced orders could add to a move if price reaches them. Because the map is a model, a real cluster may be elsewhere or may not exist.'],
      ['Sources that disagree', 'If two exchanges show different open interest or ratios, that is often just different definitions or sizes. Look at the source tag before comparing them.'],
    ],
  },
  {
    id: 'glossary',
    title: 'Glossary',
    paragraphs: [],
    terms: [
      ['Perp (perpetual)', 'A futures contract with no expiry. It tracks the spot price through funding payments.'],
      ['Mark price', 'The reference price an exchange uses to value open positions and trigger liquidations. It is smoother than the last traded price, so the two can differ slightly. Paperline fills and liquidates at the mark.'],
      ['Maintenance margin', 'The minimum margin a position must keep. When the loss eats the margin down to this level, the position is liquidated. In Paperline it is a percentage of the position value that depends on the size tier.'],
      ['Liquidation', 'The forced closing of a leveraged position when its margin can no longer cover the loss. In Paperline the whole margin of that position is forfeited.'],
      ['Funding', 'A periodic payment between longs and shorts on perpetuals. Positive means longs pay shorts. The interval depends on the contract and is commonly 8 hours. Paper futures ignore it.'],
      ['Open interest', 'The total size of contracts that are open and not yet closed. It is not the same as volume.'],
      ['Long/short ratio', 'The number of accounts (or the top traders\' positions) on the long side divided by those on the short side. Its definition differs between exchanges.'],
      ['TP / SL', 'Take-profit and stop-loss: orders that close a position when the price reaches a target in profit (TP) or a limit in loss (SL).'],
    ],
  },
  {
    id: 'limits',
    title: 'Limits and FAQ',
    paragraphs: [
      'Paperline is a simulator for learning. It is not an exchange, a broker or a financial adviser.',
    ],
    bullets: [
      'Paper trading only: no real money, deposits or withdrawals.',
      'Simulated fills are at the server price. They do not include real slippage, queue position or latency, so results do not predict live trading.',
      'Estimates are labelled as estimates. The liquidation feed is sampled.',
      'Data can be delayed, incomplete or unavailable. The app shows that state instead of guessing.',
      'Is it real money? No. Everything is simulated.',
      'Can I trust the liquidation map? Treat it as a model of where leverage might cluster, not a list of real positions.',
    ],
  },
  {
    id: 'tips',
    title: 'Keyboard and mobile tips',
    paragraphs: [
      'The search button in the header opens the command palette, where you can jump to any page.',
    ],
    bullets: [
      'Press Escape to close drawers, popovers and the mobile menu.',
      'On a phone, the menu button opens the navigation drawer.',
      'Turn on Reduce motion in Settings > Preferences to switch off animations. The app also follows your device setting.',
    ],
  },
];
