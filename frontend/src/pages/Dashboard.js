import React, { useEffect, useMemo } from 'react';
import CopilotPanel from '../components/ai/CopilotPanel';
import MoverBias from '../components/dashboard/MoverBias';
import usePolling from '../lib/usePolling';
import usePortfolio from '../lib/usePortfolio';
import useUserStore from '../store/userStore';
import useAlertStore from '../store/alertStore';
import { FUT } from '../components/liquidation/shared';
import { PriceTile, PortfolioTile, OiTile, FundingTile, LiqTile, AlertsTile, SentimentTile } from '../components/dashboard/Tiles';
import { MoversPanel, LiquidationsPanel, HoldingsPanel, AlertTriggersPanel } from '../components/dashboard/Panels';
import { allocation, valueHoldings } from '../components/dashboard/stats';
import { CardBoundary, NewsCard, RealMarketsCard, DerivativesPulseCard, LiquidationsSampledCard, MarketClock, QuickActions } from '../components/dashboard/Cards';
import { API } from '../lib/apiBase';

const ALERTS_MS = 30000;
const MARKET_ERR = 'Market data unavailable, retrying.';
const LIQ_ERR = 'Liquidation data unavailable, retrying.';
const CHART_ERR = 'Chart unavailable';

const QUOTES_MS = 60000;

const Heading = ({ children }) => <h2 className="shrink-0 pt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</h2>;

const closesOf = (data) => (Array.isArray(data) ? data.map((k) => k.close) : null);

// Command-center landing page: every card links to the page it summarises.
const Dashboard = () => {
  const token = useUserStore((s) => s.token);
  const ov = usePolling(`${FUT}/overview`, 30000);
  const liq = usePolling(`${FUT}/liquidations`, 30000);
  const btc = usePolling(`${FUT}/klines/BTCUSDT?interval=1h&limit=24`, 60000);
  const eth = usePolling(`${FUT}/klines/ETHUSDT?interval=1h&limit=24`, 60000);
  const quotes = usePolling(`${API}/api/market/instruments/quotes`, QUOTES_MS);
  const port = usePortfolio(token);
  const { alerts, events, loaded, error: alertErr, unread, load } = useAlertStore();

  useEffect(() => {
    const run = () => { if (!document.hidden) load(token); };
    run();
    const t = setInterval(run, ALERTS_MS);
    return () => clearInterval(t);
  }, [token, load]);

  const rows = useMemo(() => (Array.isArray(ov.data) ? ov.data : []), [ov.data]);
  const bySym = (s) => rows.find((r) => r.symbol === s);
  const marketErr = ov.error && !rows.length ? MARKET_ERR : null;
  const valued = useMemo(() => valueHoldings(port.holdings, rows), [port.holdings, rows]);
  const totalValue = valued.value === null || !Number.isFinite(port.balance) ? null : valued.value + port.balance;
  const alloc = useMemo(() => (valued.value === null ? null : allocation(port.balance, valued.items)), [valued, port.balance]);
  const marketLoading = ov.loading;

  return (
    <div className="flex flex-col gap-3 xl:h-full xl:min-h-0 xl:overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardBoundary><MarketClock quotes={quotes} /></CardBoundary>
        <QuickActions />
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <PriceTile symbol="BTCUSDT" row={bySym('BTCUSDT')} closes={closesOf(btc.data)} chartError={btc.error && !btc.data ? CHART_ERR : null} loading={marketLoading} error={marketErr} />
        <PriceTile symbol="ETHUSDT" row={bySym('ETHUSDT')} closes={closesOf(eth.data)} chartError={eth.error && !eth.data ? CHART_ERR : null} loading={marketLoading} error={marketErr} />
        <PortfolioTile
          loading={port.loading || marketLoading}
          error={port.error ? 'Portfolio unavailable, retrying.' : null}
          value={totalValue}
          pnlPct={valued.pnlPct}
          holdingCount={port.holdings.length}
          alloc={alloc}
        />
        <OiTile rows={rows} loading={marketLoading} error={marketErr} />
        <FundingTile rows={rows} loading={marketLoading} error={marketErr} />
        <LiqTile windows={liq.data?.windows} loading={liq.loading} error={liq.error && !liq.data ? LIQ_ERR : null} />
        <AlertsTile alerts={alerts} events={events} unread={unread} loaded={loaded} error={alertErr} />
        <SentimentTile rows={rows} loading={marketLoading} error={marketErr} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:h-[640px] xl:shrink-0 xl:grid-cols-3 xl:grid-rows-2">
        <MoversPanel rows={rows} loading={marketLoading} failed={!!ov.error} />
        <LiquidationsPanel recent={liq.data?.recent} loading={liq.loading} failed={!!liq.error} />
        <HoldingsPanel items={valued.items} loading={port.loading || marketLoading} failed={!!port.error} />
        <AlertTriggersPanel events={events} loaded={loaded} failed={!!alertErr} />
        <div className="flex min-h-0 flex-col gap-3 max-xl:-order-1 md:max-xl:col-span-2 xl:overflow-auto">
          <CardBoundary><MoverBias rows={rows} loading={marketLoading} failed={!!ov.error} /></CardBoundary>
          <CopilotPanel symbol="BTCUSDT" />
        </div>
      </div>

      <Heading>Market intelligence</Heading>
      <div className="grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-12">
        <div className="md:col-span-2 xl:order-4 xl:col-span-12"><NewsCard /></div>
        <div className="xl:col-span-4"><CardBoundary><RealMarketsCard res={quotes} /></CardBoundary></div>
        <div className="xl:col-span-4"><CardBoundary><DerivativesPulseCard rows={rows} loading={marketLoading} failed={!!ov.error} /></CardBoundary></div>
        <div className="md:col-span-2 xl:col-span-4"><CardBoundary><LiquidationsSampledCard data={liq.data} loading={liq.loading} failed={!!liq.error} /></CardBoundary></div>
      </div>
    </div>
  );
};

export default Dashboard;
