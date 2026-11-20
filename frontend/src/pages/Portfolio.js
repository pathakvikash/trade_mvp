import React, { useMemo } from 'react';
import useUserStore from '../store/userStore';
import usePortfolio from '../lib/usePortfolio';
import usePolling from '../lib/usePolling';
import useFutures from '../lib/useFutures';
import { unrealized } from '../lib/futuresMath';
import { Link } from 'react-router-dom';
import { FUT, coin as baseOf } from '../components/liquidation/shared';
import Card from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import { Updating } from '../components/ui/Spinner';

// Placeholder rows shaped like the table they stand in for (cols = column count).
const SkeletonRows = ({ rows = 3, cols }) => Array.from({ length: rows }, (_, i) => (
  <tr key={i} className="border-b-0">
    {Array.from({ length: cols }, (_, j) => <td key={j} className="py-4"><Skeleton className="h-3.5 w-16" /></td>)}
  </tr>
));

const formatCurrency = (value) => {
  if (!Number.isFinite(value)) return '--';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
};

const formatDate = (dateString) =>
  new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const Portfolio = () => {
  const token = useUserStore((s) => s.token);
  const { balance, holdings: base, trades, error, loading, fetching, reload } = usePortfolio(token);
  const ov = usePolling(`${FUT}/overview`, 15000);
  const fut = useFutures(token);

  const futSummary = useMemo(() => {
    const px = {};
    (Array.isArray(ov.data) ? ov.data : []).forEach((r) => { px[baseOf(r.symbol)] = r.lastPrice ?? r.markPrice; });
    const marks = fut.positions.map((p) => (Number.isFinite(px[p.symbol]) ? px[p.symbol] : p.markPrice));
    const live = fut.positions.map((p, i) => (marks[i] > 0 ? unrealized(p, marks[i]).pnl : null));
    return {
      count: fut.positions.length,
      margin: fut.positions.reduce((s, p) => s + (p.margin || 0), 0),
      unreal: live.every(Number.isFinite) ? live.reduce((a, b) => a + b, 0) : null,
      realised: [...fut.positions, ...fut.closedPositions].reduce((s, p) => s + (p.realizedPnl || 0), 0),
    };
  }, [fut.positions, fut.closedPositions, ov.data]);

  // Value at the futures last/mark price (overview = top-40 perps). A missing price stays null (shown as --);
  // it must never turn into $0 / -100%.
  const { holdings, totalValue, totalPnL } = useMemo(() => {
    const px = {};
    (Array.isArray(ov.data) ? ov.data : []).forEach((r) => { px[baseOf(r.symbol)] = r.lastPrice ?? r.markPrice; });
    const rows = base.map((h) => {
      const currentPrice = Number.isFinite(px[h.symbol]) ? px[h.symbol] : null;
      if (currentPrice === null) return { ...h, currentPrice, value: null, pnL: null, pnLPercentage: null };
      const value = h.amount * currentPrice;
      const cost = h.amount * h.avgCost;
      const pnL = value - cost;
      return { ...h, currentPrice, value, pnL, pnLPercentage: cost > 0 ? (pnL / cost) * 100 : 0 };
    });
    const complete = rows.every((h) => h.value !== null);
    return {
      holdings: rows,
      totalValue: complete ? rows.reduce((s, h) => s + h.value, 0) : null,
      totalPnL: complete ? rows.reduce((s, h) => s + h.pnL, 0) : null,
    };
  }, [base, ov.data]);

  // First load: the same layout with skeleton numbers and rows (never $0.00 or an empty table).
  // Refetch (after an order): old numbers stay, dimmed, with an Updating chip.
  const dim = fetching ? 'opacity-60 transition-opacity' : 'transition-opacity';
  const kpi = (value, cls = 'text-white') => (loading ? <Skeleton className="mt-3 h-7 w-32" /> : <p className={`mt-2 text-2xl font-bold ${cls}`}>{value}</p>);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {error && (
        <Card className="border-red-800/50 bg-red-950/20">
          <p className="text-red-300">Unable to load your portfolio: {error}</p>
          <button type="button" onClick={reload} className="focus-ring mt-3 rounded-md border border-red-800/60 px-3 py-1 text-sm text-red-200 hover:bg-red-900/30">Retry</button>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold text-white">Portfolio</h1>
        <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-400">Paper trading</span>
        <Updating show={!!fetching} />
        {loading && <span className="sr-only" role="status">Loading your portfolio…</span>}
      </div>

      {/* Portfolio Summary */}
      <Card className={dim}>
        <h2 className="mb-6 text-xl font-semibold text-white">Portfolio Summary</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Cash Balance</h3>
            {kpi(formatCurrency(balance))}
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Holdings Value</h3>
            {kpi(formatCurrency(totalValue))}
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="text-sm font-medium text-slate-400">Unrealized Profit/Loss</h3>
            {kpi(formatCurrency(totalPnL), totalPnL === null ? 'text-slate-400' : totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}
          </div>
        </div>
      </Card>

      {/* Futures summary (hidden until the futures API answers, so a missing backend never shows zeros) */}
      {!fut.loading && !fut.error && (
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Futures</h2>
            <Link to="/trade" className="focus-ring text-sm text-cyan-300 hover:underline">Open Trade</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ['Open positions', String(futSummary.count), 'text-white'],
              ['Margin in use', formatCurrency(futSummary.margin), 'text-white'],
              ['Unrealized P/L', formatCurrency(futSummary.unreal), futSummary.unreal === null ? 'text-slate-400' : futSummary.unreal >= 0 ? 'text-emerald-400' : 'text-red-400'],
              ['Realized P/L', formatCurrency(futSummary.realised), futSummary.realised >= 0 ? 'text-emerald-400' : 'text-red-400'],
            ].map(([l, v, c]) => (
              <div key={l} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
                <h3 className="text-sm font-medium text-slate-400">{l}</h3>
                <p className={`mt-2 text-xl font-bold ${c}`}>{v}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Holdings */}
      <Card className={dim}>
        <h2 className="mb-6 text-xl font-semibold text-white">Your Holdings</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Asset</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Amount</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Avg Buy Price</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Current Price</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Value</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">P/L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && <SkeletonRows cols={6} />}
              {!loading && holdings.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-sm text-slate-500">No holdings yet.</td></tr>
              )}
              {!loading && holdings.map((holding) => (
                <tr key={holding.symbol} className="hover:bg-slate-900/30">
                  <td className="py-4 font-medium text-white">{holding.symbol}</td>
                  <td className="py-4 text-white">{Number(holding.amount.toFixed(6))}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.avgCost)}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.currentPrice)}</td>
                  <td className="py-4 text-white">{formatCurrency(holding.value)}</td>
                  <td className={`py-4 ${holding.pnL === null ? 'text-slate-400' : holding.pnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(holding.pnL)}
                    {holding.pnL !== null && (
                      <span className="text-sm">
                        ({holding.pnL >= 0 ? '+' : ''}{holding.pnLPercentage.toFixed(2)}%)
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent Transactions */}
      <Card className={dim}>
        <h2 className="mb-6 text-xl font-semibold text-white">Recent Transactions</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Type</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Asset</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Amount</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Price</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Fee</th>
                <th className="pb-3 text-left text-sm font-medium text-slate-400">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && <SkeletonRows cols={6} />}
              {!loading && trades.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-sm text-slate-500">No transactions yet.</td></tr>
              )}
              {!loading && trades.map((tx) => (
                <tr key={tx._id} className="hover:bg-slate-900/30">
                  <td className={`py-4 font-medium capitalize ${tx.type === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {tx.type}
                  </td>
                  <td className="py-4 text-white">{tx.cryptoSymbol}</td>
                  <td className="py-4 text-white">{Number(tx.amount.toFixed(6))}</td>
                  <td className="py-4 text-white">{formatCurrency(tx.priceAtTrade)}</td>
                  <td className="py-4 text-white">{formatCurrency(tx.fee)}</td>
                  <td className="py-4 text-white">{formatDate(tx.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default Portfolio;
