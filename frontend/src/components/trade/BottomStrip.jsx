import React, { useMemo, useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import PositionsTable, { futuresErr } from './PositionsTable';
import SpotHoldings from './SpotHoldings';
import FuturesHistory from './FuturesHistory';
import Panel from '../ui/Panel';
import usePersistedState, { oneOf } from '../../lib/usePersistedState';
import SegTabs from '../ui/SegTabs';
import { fmtPrice } from '../ui/fmt';
import Skeleton from '../ui/Skeleton';
import Spinner, { Updating } from '../ui/Spinner';
import CopilotPanel from '../ai/CopilotPanel';

const TAB_DEFS = [{ id: 'positions', label: 'Positions' }, { id: 'orders', label: 'Open orders' }, { id: 'history', label: 'History' }, { id: 'copilot', label: 'AI Copilot' }];
const withBadge = (label, n) => (n > 0 ? <>{label} <span className="ml-0.5 rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-200" data-testid="tab-count">{n}</span></> : label);
const COLS = { orders: 'grid-cols-5', history: 'grid-cols-4' };
const ORDER_HEAD = ['Order', 'Amount', 'Limit', 'Status', 'Action'];

const Table = ({ tab, head, rows, empty, loading }) => (
  <div className="min-w-[320px]">
    <div className={`grid ${COLS[tab]} pb-1 text-[10px] uppercase tracking-wider text-slate-500`}>
      {head.map((h, i) => <span key={h} className={i ? 'text-right' : ''}>{h}</span>)}
    </div>
    {loading && (
      <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-3 w-full" />)}
      </div>
    )}
    {!loading && rows.length === 0 && <div className="py-2 text-xs text-slate-500">{empty}</div>}
    {!loading && rows.map((r) => (
      <div key={r.key} className={`grid ${COLS[tab]} py-1 text-xs tabular-nums`}>
        {r.cells.map((c, i) => <span key={i} className={`${i ? 'text-right' : ''} ${c.cls || 'text-slate-300'}`}>{c.node ?? c.text}</span>)}
      </div>
    ))}
  </div>
);

// Real paper-trading data: `account` is usePortfolio() (balance, holdings, trades); `prices` maps base symbol -> last
// futures price (P&L shows -- when the symbol is outside the overview).
const BottomStrip = ({ account, prices = {}, symbol, orders, futures, onSelectSymbol, className = '' }) => {
  const [tab, setTab] = usePersistedState('trade.bottomTab', 'positions', { validate: oneOf(...TAB_DEFS.map((t) => t.id)) });
  const token = useUserStore((s) => s.token);
  const [fCancelling, setFCancelling] = useState(null);
  const [fCancelErr, setFCancelErr] = useState('');
  const cancelFutures = async (id) => {
    setFCancelling(id);
    setFCancelErr('');
    try {
      await axios.delete(`${API}/api/futures/orders/${id}`, authed(token));
      futures?.reload?.();
    } catch (e) {
      setFCancelErr(futuresErr(e));
    } finally {
      setFCancelling(null);
    }
  };
  const { holdings = [], trades = [], error, loading, fetching, reload } = account || {};
  const { rows: orderRows = [], cancellingId, onCancel } = orders || {};
  const { history } = useMemo(() => ({
    history: trades.map((t) => ({
      key: t._id,
      cells: [
        { text: `${t.type === 'sell' ? 'Sell' : 'Buy'} ${t.cryptoSymbol}`, cls: t.type === 'sell' ? 'text-rose-400' : 'text-emerald-400' },
        { text: String(Number(t.amount.toFixed(6))) },
        { text: fmtPrice(t.priceAtTrade) },
        { text: new Date(t.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), cls: 'text-slate-500' },
      ],
    })),
  }), [trades]);

  const openRows = orderRows.map((o) => {
    const busy = cancellingId === o._id;
    return {
      key: o._id,
      cells: [
        { text: `${o.side === 'sell' ? 'Sell' : 'Buy'} ${o.symbol}`, cls: o.side === 'sell' ? 'text-rose-400' : 'text-emerald-400' },
        { text: String(Number(o.amount.toFixed(6))) },
        { text: fmtPrice(o.limitPrice) },
        { text: o.status, cls: 'text-slate-400' },
        {
          node: (
            <button
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => onCancel(o._id)}
              className="focus-ring inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Spinner size={10} />}
              {busy ? 'Cancelling' : 'Cancel'}
            </button>
          ),
        },
      ],
    };
  });
  const fOrders = futures?.orders || [];
  const futOrderRows = fOrders.map((o) => {
    const busy = fCancelling === o._id;
    const long = o.side === 'long';
    return {
      key: `f${o._id}`,
      cells: [
        { node: <><span className={long ? 'text-emerald-400' : 'text-rose-400'}>{long ? 'Long' : 'Short'} {o.leverage}x {o.symbol}</span> <span className="rounded bg-cyan-400/10 px-1 text-[10px] text-cyan-300">Futures</span></> },
        { text: String(Number(Number(o.size).toFixed(6))) },
        { text: fmtPrice(o.limitPrice) },
        { text: o.status, cls: 'text-slate-400' },
        { node: <button type="button" disabled={busy} aria-busy={busy} onClick={() => cancelFutures(o._id)} className="focus-ring inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">{busy && <Spinner size={10} />}{busy ? 'Cancelling' : 'Cancel'}</button> },
      ],
    };
  });
  const tabs = TAB_DEFS.map((t) => (t.id === 'positions' ? { ...t, label: withBadge(t.label, (futures?.positions?.length || 0) + holdings.length) }
    : t.id === 'orders' ? { ...t, label: withBadge(t.label, orderRows.length + fOrders.length) } : t));
  const ordersTab = tab === 'orders';
  const isFetching = ordersTab ? !!orders?.fetching : !!fetching;
  const err = (ordersTab ? orders?.error || fCancelErr : error) || (tab === 'positions' || tab === 'history' ? futures?.error : '');

  // Copilot stays mounted (hidden) so a billed brief survives tab switches.
  return (
    <Panel className={`${tab === 'copilot' ? 'h-96' : 'h-72'} xl:h-auto xl:min-h-0 ${className}`} bodyClassName="min-h-0 overflow-auto p-3 pt-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SegTabs tabs={tabs} active={tab} onChange={setTab} label="Account tables" className="-ml-2" />
          {tab !== 'copilot' && <Updating show={isFetching} />}
        </div>
        {tab !== 'copilot' && err && (
          <span className="flex items-center gap-2 text-[10px] text-rose-300">
            {err}
            {!ordersTab && reload && <button type="button" onClick={reload} className="focus-ring rounded border border-rose-400/40 px-1.5 py-0.5 text-rose-200 hover:bg-rose-400/10">Retry</button>}
          </span>
        )}
      </div>
      <div className={tab === 'copilot' ? '' : `transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
        {tab === 'positions' && (
          <>
            {futures && <PositionsTable positions={futures.positions} prices={prices} loading={futures.loading} onSelectSymbol={onSelectSymbol} onChanged={futures.reload} />}
            <SpotHoldings holdings={holdings} trades={trades} prices={prices} loading={loading} />
          </>
        )}
        {ordersTab && <Table tab="orders" head={ORDER_HEAD} rows={[...openRows, ...futOrderRows]} loading={!!orders?.loading} empty="No open orders." />}
        {tab === 'history' && (
          <>
            <FuturesHistory closed={futures?.closedPositions} />
            {futures?.closedPositions?.length > 0 && <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">Spot trades</h3>}
            <Table tab="history" head={['Trade', 'Amount', 'Price', 'Time']} rows={history} loading={loading} empty="No trades yet." />
          </>
        )}
      </div>
      {symbol && <div className={tab === 'copilot' ? '' : 'hidden'}><CopilotPanel symbol={symbol} className="border-0 bg-transparent" /></div>}
    </Panel>
  );
};

export default BottomStrip;
