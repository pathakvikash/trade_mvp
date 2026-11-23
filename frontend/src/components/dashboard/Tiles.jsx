import React from 'react';
import Tile from './Tile';
import Sparkline from './Sparkline';
import { SplitBar } from './Bars';
import { fmtFunding, toneCls } from './format';
import { breadth, fundingSplit, oiShare, weightedFunding } from './stats';
import { coin, fmtPct, fmtMarketPrice, fmtPrice, fmtTime, fmtUsd } from '../liquidation/shared';
import { describeAlert } from '../alerts/alertLogic';

const UP = 'bg-emerald-400/70';
const DOWN = 'bg-rose-400/70';
const SHADES = ['bg-cyan-400/70', 'bg-violet-400/70', 'bg-amber-400/70', 'bg-sky-400/70', 'bg-slate-500/70'];

export const PriceTile = ({ symbol, row, closes, chartError, loading, error }) => {
  const c = coin(symbol);
  return (
    <Tile
      to={`/trade?symbol=${c}`}
      page="Trade"
      label={c}
      loading={loading}
      error={error}
      value={row ? fmtMarketPrice(row.lastPrice) : '--'}
      sub={row ? <span className={toneCls(row.priceChangePercent)}>{fmtPct(row.priceChangePercent)} 24h</span> : null}
      visual={closes && closes.length > 1 ? <Sparkline values={closes} /> : chartError ? <span className="text-[11px] text-amber-400">{chartError}</span> : null}
    />
  );
};

// alloc: allocation() result, or null while holdings cannot be valued.
export const PortfolioTile = ({ loading, error, value, pnlPct, holdingCount, alloc }) => {
  const segs = alloc
    ? [
      { value: alloc.cash, cls: 'bg-cyan-400/70' },
      ...alloc.items.slice(0, 4).map((it, i) => ({ value: it.value, cls: SHADES[i] })),
      { value: alloc.items.slice(4).reduce((s, it) => s + it.value, 0), cls: SHADES[4] },
    ]
    : [];
  let sub = null;
  if (holdingCount === 0) sub = 'Cash only';
  else if (Number.isFinite(pnlPct)) sub = <span className={toneCls(pnlPct)}>{fmtPct(pnlPct)} unrealised</span>;
  else if (!loading) sub = 'Price unavailable for a holding';
  return (
    <Tile
      to="/portfolio"
      page="Portfolio"
      label="Portfolio"
      loading={loading}
      error={error}
      value={Number.isFinite(value) ? `$${fmtPrice(value)}` : '--'}
      sub={sub}
      visual={alloc && alloc.total > 0 ? <SplitBar segments={segs} label="Allocation: cash and top holdings" /> : null}
    />
  );
};

export const OiTile = ({ rows, loading, error }) => {
  const s = oiShare(rows, 3);
  const rest = s.total - s.top.reduce((x, t) => x + t.usd, 0);
  return (
    <Tile
      to="/derivatives"
      page="Derivatives"
      label="Open int."
      loading={loading}
      error={error}
      value={s.total > 0 ? fmtUsd(s.total) : '--'}
      sub={s.top.length ? s.top.map((t) => `${t.symbol} ${(t.share * 100).toFixed(0)}%`).join(' · ') : null}
      visual={s.top.length ? (
        <SplitBar
          label="Open interest share of the top 3 symbols"
          segments={[...s.top.map((t, i) => ({ value: t.usd, cls: SHADES[i] })), { value: rest, cls: SHADES[4] }]}
        />
      ) : null}
    />
  );
};

export const FundingTile = ({ rows, loading, error }) => {
  const avg = weightedFunding(rows);
  const sp = fundingSplit(rows);
  return (
    <Tile
      to="/derivatives"
      page="Derivatives"
      label="Funding"
      loading={loading}
      error={error}
      value={fmtFunding(avg)}
      sub={sp.total ? `vol-weighted · ${sp.pos} above 0, ${sp.neg} below` : null}
      visual={sp.total ? <SplitBar label="Perps with funding above or below zero" segments={[{ value: sp.pos, cls: UP }, { value: sp.neg, cls: DOWN }]} /> : null}
    />
  );
};

const liqTotal = (w) => (w ? w.longUsd + w.shortUsd : null);

export const LiqTile = ({ windows, loading, error }) => {
  const h1 = windows?.['1h'];
  const h24 = windows?.['24h'];
  const bar = (w) => (w && liqTotal(w) > 0
    ? <SplitBar label="Long against short liquidations" segments={[{ value: w.longUsd, cls: UP }, { value: w.shortUsd, cls: DOWN }]} />
    : null);
  return (
    <Tile
      to="/liquidation"
      page="Liquidations"
      label="Liq. 1h"
      loading={loading}
      error={error}
      value={liqTotal(h1) !== null ? fmtUsd(liqTotal(h1)) : '--'}
      sub={liqTotal(h24) !== null ? `24h ${fmtUsd(liqTotal(h24))} · sampled` : null}
      visual={h1 || h24 ? (
        <div className="space-y-1">
          {[['1h', h1], ['24h', h24]].map(([k, w]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-6 text-[10px] text-slate-500">{k}</span>
              <div className="min-w-0 flex-1">{bar(w)}</div>
            </div>
          ))}
        </div>
      ) : null}
    />
  );
};

export const AlertsTile = ({ alerts, events, unread, loaded, error }) => {
  const active = alerts.filter((a) => a.active !== false).length;
  const last = events[0];
  return (
    <Tile
      to="/trade?alerts=1"
      page="Alerts"
      label="Alerts"
      loading={!loaded}
      error={loaded && error ? 'Alerts unavailable, retrying.' : null}
      badge={unread > 0 ? `${unread} new` : null}
      value={`${active} active`}
      sub={last ? `Last: ${describeAlert(last)} · ${fmtTime(last.ts)}` : 'No triggers yet'}
    />
  );
};

export const SentimentTile = ({ rows, loading, error }) => {
  const b = breadth(rows, 50);
  return (
    <Tile
      to="/market"
      page="Market"
      label="Sentiment"
      loading={loading}
      error={error}
      value={b.total ? `${b.up} of ${b.total} up` : '--'}
      sub={b.total ? `24h change, top ${b.total} perps by volume` : null}
      visual={b.total ? <SplitBar label={`${b.up} of ${b.total} perps up in 24 hours`} segments={[{ value: b.up, cls: UP }, { value: b.total - b.up, cls: DOWN }]} /> : null}
    />
  );
};
