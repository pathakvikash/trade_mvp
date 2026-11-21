import React, { useMemo, useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import PositionsTable, { futuresErr, TpSlInputs, readTpSl, TpSlCell } from './PositionsTable';
import { tpSlErrors } from './TpSlFields';
import { openQuote } from '../../lib/futuresMath';
import SpotHoldings from './SpotHoldings';
import FuturesHistory from './FuturesHistory';
import Panel from '../ui/Panel';
import usePersistedState, { oneOf } from '../../lib/usePersistedState';
import SegTabs from '../ui/SegTabs';
import { fmtPrice, fmtQty } from '../ui/fmt';
import { Tip } from '../ui/Tooltip';
import Skeleton from '../ui/Skeleton';
import Spinner, { Updating } from '../ui/Spinner';
import CopilotPanel from '../ai/CopilotPanel';

const TAB_DEFS = [{ id: 'positions', label: 'Positions' }, { id: 'orders', label: 'Open orders' }, { id: 'history', label: 'History' }, { id: 'copilot', label: 'AI Copilot' }];
const withBadge = (label, n) => (n > 0 ? <>{label} <span className="ml-0.5 rounded-full bg-slate-700 px-1.5 text-[10px] text-slate-200" data-testid="tab-count">{n}</span></> : label);
const COLS = { history: 'grid-cols-4' };

const Table = ({ tab, head, rows, empty, loading }) => (
  <div className="overflow-x-auto"><div className="min-w-[320px]">
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
      <React.Fragment key={r.key}>
        <div className={`grid ${COLS[tab]} py-1 text-xs tabular-nums`}>
          {r.cells.map((c, i) => <span key={i} className={`${i ? 'text-right' : ''} ${c.cls || 'text-slate-300'}`}>{c.node ?? c.text}</span>)}
        </div>
        {r.extra}
      </React.Fragment>
    ))}
  </div></div>
);

const smallBtn = 'focus-ring inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60';

// TP/SL edit on an open futures limit order: PATCH /api/futures/orders/:id. Bounds vs the limit price and the quoted
// liq, like placement. Price, size and leverage are not editable (they set the reservation): cancel and re-place.
const OrderTpSlEdit = ({ order, config, token, onDone, onCancel }) => {
  const [text, setText] = useState({ tp: order.tp == null ? '' : String(order.tp), sl: order.sl == null ? '' : String(order.sl) });
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState('');
  const r = readTpSl(text, order);
  const liq = openQuote(order.side, order.size, order.limitPrice, order.leverage, config).liqPrice;
  const bounds = tpSlErrors({ side: order.side, refPrice: order.limitPrice, liqPrice: liq, tp: r.tp, sl: r.sl }) || {};
  const errs = { tp: r.fmt.tp || bounds.tp || null, sl: r.fmt.sl || bounds.sl || null };
  const blocked = !!(errs.tp || errs.sl) || !(r.changed.tp || r.changed.sl);
  const save = async () => {
    if (blocked) return;
    const body = {};
    if (r.changed.tp) body.tp = r.tp;
    if (r.changed.sl) body.sl = r.sl;
    setPending(true);
    setErr('');
    try {
      await axios.patch(`${API}/api/futures/orders/${order._id}`, body, authed(token));
      onDone?.();
    } catch (e) {
      setErr(futuresErr(e));
      setPending(false);
    }
  };
  return (
    <div role="group" aria-label={`Edit TP/SL of ${order.symbol} limit order`} className="mb-1 flex flex-wrap items-end gap-2 rounded-lg border border-cyan-400/30 bg-slate-900/70 p-2 text-[11px]">
      <TpSlInputs idPrefix={`ord-${order._id}`} value={text} errs={errs} disabled={pending} onChange={(v) => { setText(v); setErr(''); }} />
      <button type="button" onClick={save} disabled={blocked || pending} aria-busy={pending || undefined} className={`${smallBtn} border-cyan-400/50 text-cyan-200`}>{pending && <Spinner size={10} />}Save</button>
      <button type="button" onClick={onCancel} disabled={pending} className={smallBtn}>Cancel edit</button>
      {err && <span role="alert" className="text-rose-300">{err}</span>}
      <span className="basis-full text-[10px] text-slate-500">Price, size or leverage: cancel and re-place.</span>
    </div>
  );
};

export const ageText = (createdAt, now = Date.now()) => {
  const s = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  if (!Number.isFinite(s)) return '--';
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

const ORDER_HEAD = ['Type', 'Symbol', 'Side', 'Price', 'Size', 'Reserved', 'TP / SL', 'Age', ''];

// Every unfilled limit order in one table: spot (GET /api/orders, cancelled through the page's onCancel) and futures
// (GET /api/futures/orders, cancelled and TP/SL-edited here). Newest first.
export const OpenOrdersTable = ({ spot = [], futures = [], loading, cancellingId, onCancelSpot, fCancelling, onCancelFutures, editing, onEdit, editor }) => {
  const rows = [
    ...spot.map((o) => ({ kind: 'spot', o })),
    ...futures.map((o) => ({ kind: 'futures', o })),
  ].sort((a, b) => new Date(b.o.createdAt || 0) - new Date(a.o.createdAt || 0));
  if (loading && !rows.length) {
    return <div className="space-y-2 py-1" aria-busy="true" aria-label="Loading">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-3 w-full" />)}</div>;
  }
  if (!rows.length) {
    return (
      <div className="py-2 text-xs text-slate-400" data-testid="orders-empty">
        <p>No open orders. Limit orders you place wait here until the price is reached, then fill automatically.</p>
        <p className="mt-1 text-[11px] text-slate-500">To place one, switch the Order card to <b className="text-slate-300">Limit</b> and set a price.</p>
      </div>
    );
  }
  const td = 'whitespace-nowrap px-1.5 py-1 align-top';
  return (
    <div className="overflow-x-auto">
      <table aria-label="Open orders" className="w-full border-separate border-spacing-0 text-xs tabular-nums text-slate-300">
        <thead>
          <tr>
            {ORDER_HEAD.map((h, i) => (
              <th key={h || 'act'} scope="col" className={`whitespace-nowrap bg-slate-950 px-1.5 pb-1 text-[10px] font-normal uppercase tracking-wider text-slate-500 ${i >= 3 && i <= 5 ? 'text-right' : 'text-left'} ${h ? '' : 'sticky right-0'}`}>
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ kind, o }) => {
            const fut = kind === 'futures';
            const up = fut ? o.side === 'long' : o.side !== 'sell';
            const busy = fut ? fCancelling === o._id : cancellingId === o._id;
            const sideText = fut ? (up ? 'Long' : 'Short') : (up ? 'Buy' : 'Sell');
            const name = `${o.symbol} ${sideText.toLowerCase()} limit order`;
            const toggleEdit = () => onEdit(editing === o._id ? null : o._id);
            return (
              <React.Fragment key={`${kind}${o._id}`}>
                <tr data-testid={`order-${kind}`}>
                  <td className={td}><span className={`rounded px-1 text-[10px] ${fut ? 'bg-cyan-400/10 text-cyan-300' : 'bg-slate-700/40 text-slate-300'}`}>{fut ? 'Futures' : 'Spot'}</span></td>
                  <td className={`${td} font-medium text-slate-100`}>{o.symbol}</td>
                  <td className={`${td} ${up ? 'text-emerald-400' : 'text-rose-400'}`}>{sideText}{fut ? ` ${o.leverage}x` : ''}</td>
                  <td className={`${td} text-right`}>{fmtPrice(o.limitPrice)}</td>
                  <td className={`${td} text-right`}>{fmtQty(fut ? o.size : o.amount)}</td>
                  <td className={`${td} text-right`}>
                    {fut || up ? `$${fmtPrice(o.reserved)}` : `${fmtQty(o.reserved)} ${o.symbol}`}
                    <span className="block text-[10px] text-slate-500">{fut ? `margin + fee, ${o.leverage}x` : up ? 'funds held' : 'coins held'}</span>
                  </td>
                  <td className={td}>
                    {fut ? (
                      <TpSlCell tp={o.tp} sl={o.sl} name={name} onEdit={toggleEdit} disabled={busy} expanded={editing === o._id} />
                    ) : <span className="text-slate-600">--</span>}
                  </td>
                  <td className={`${td} text-slate-500`}>{o.createdAt ? ageText(o.createdAt) : '--'}</td>
                  <td className={`${td} sticky right-0 bg-slate-950 text-right`}>
                    <Tip text="Cancel order (frees the reserved funds)">
                      <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => (fut ? onCancelFutures(o._id) : onCancelSpot?.(o._id))} aria-label={`Cancel ${name}`}
                        className="focus-ring inline-flex h-7 items-center gap-1 rounded border border-rose-400/40 px-2 text-[11px] font-medium text-rose-200 hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-50">
                        {busy && <Spinner size={10} />}Cancel
                      </button>
                    </Tip>
                  </td>
                </tr>
                {fut && editing === o._id && <tr><td colSpan={ORDER_HEAD.length} className="px-2 pb-1"><div className="sticky left-0 w-[min(100%,40rem)]">{editor(o)}</div></td></tr>}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// Real paper-trading data: `account` is usePortfolio() (balance, holdings, trades); `prices` maps base symbol -> last
// futures price (P&L shows -- when the symbol is outside the overview).
const BottomStrip = ({ account, prices = {}, symbol, orders, futures, onSelectSymbol, className = '' }) => {
  const [tab, setTab] = usePersistedState('trade.bottomTab', 'positions', { validate: oneOf(...TAB_DEFS.map((t) => t.id)) });
  const token = useUserStore((s) => s.token);
  const [fCancelling, setFCancelling] = useState(null);
  const [fCancelErr, setFCancelErr] = useState('');
  const [fEditing, setFEditing] = useState(null); // futures order id whose TP/SL is being edited
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

  const fOrders = futures?.orders || [];
  const tabs = TAB_DEFS.map((t) => (t.id === 'positions' ? { ...t, label: withBadge(t.label, futures?.positions?.length || 0) }
    : t.id === 'orders' ? { ...t, label: withBadge(t.label, orderRows.length + fOrders.length) } : t));
  const ordersTab = tab === 'orders';
  const isFetching = ordersTab ? !!orders?.fetching : !!fetching;
  const err = (ordersTab ? orders?.error || fCancelErr : error) || (tab !== 'copilot' ? futures?.error : '');

  // Copilot stays mounted (hidden) so a billed brief survives tab switches. Wide tables scroll inside their own
  // overflow-x-auto wrapper; the body never scrolls sideways, or the tabs and summary would slide out of view.
  return (
    <Panel className={`${tab === 'copilot' ? 'h-96' : 'h-72'} xl:h-auto xl:min-h-0 ${className}`} bodyClassName={`min-h-0 p-3 pt-2 ${tab === 'copilot' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        {/* scrolls sideways on phones instead of clipping 'AI Copilot' */}
        <div className="hide-scrollbar -ml-2 flex min-w-0 items-center gap-2 overflow-x-auto">
          <SegTabs tabs={tabs} active={tab} onChange={setTab} label="Account tables" className="[&_button]:shrink-0 [&_button]:whitespace-nowrap" />
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
            {futures && <PositionsTable positions={futures.positions} prices={prices} loading={futures.loading} config={futures.config} onSelectSymbol={onSelectSymbol} onChanged={futures.reload} />}
            <SpotHoldings holdings={holdings} trades={trades} prices={prices} loading={loading} />
          </>
        )}
        {ordersTab && (
          <OpenOrdersTable
            spot={orderRows}
            futures={fOrders}
            loading={!!orders?.loading || !!futures?.loading}
            cancellingId={cancellingId}
            onCancelSpot={onCancel}
            fCancelling={fCancelling}
            onCancelFutures={cancelFutures}
            editing={fEditing}
            onEdit={setFEditing}
            editor={(o) => <OrderTpSlEdit order={o} config={futures?.config} token={token} onCancel={() => setFEditing(null)} onDone={() => { setFEditing(null); futures?.reload?.(); }} />}
          />
        )}
        {tab === 'history' && (
          <>
            <FuturesHistory closed={futures?.closedPositions} />
            {futures?.closedPositions?.length > 0 && <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">Spot trades</h3>}
            <Table tab="history" head={['Trade', 'Amount', 'Price', 'Time']} rows={history} loading={loading} empty="No trades yet." />
          </>
        )}
      </div>
      {/* On the copilot tab the strip stops scrolling and the copilot body scrolls instead, so tabs and Generate stay in view. */}
      {symbol && <div className={tab === 'copilot' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><CopilotPanel symbol={symbol} className="min-h-0 flex-1 border-0 bg-transparent" /></div>}
    </Panel>
  );
};

export default BottomStrip;
