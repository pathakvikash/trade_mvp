import React, { useMemo, useState } from 'react';
import Panel from '../ui/Panel';
import SegTabs from '../ui/SegTabs';
import { fmtPrice } from '../ui/fmt';
import CopilotPanel from '../ai/CopilotPanel';

const TABS = [{ id: 'positions', label: 'Positions' }, { id: 'history', label: 'History' }, { id: 'ai', label: 'AI Copilot' }];
const COLS = { positions: 'grid-cols-3', history: 'grid-cols-4' };

const Table = ({ tab, head, rows, empty }) => (
  <div className="min-w-[320px]">
    <div className={`grid ${COLS[tab]} pb-1 text-[10px] uppercase tracking-wider text-slate-500`}>
      {head.map((h, i) => <span key={h} className={i ? 'text-right' : ''}>{h}</span>)}
    </div>
    {rows.length === 0 && <div className="py-2 text-xs text-slate-500">{empty}</div>}
    {rows.map((r) => (
      <div key={r.key} className={`grid ${COLS[tab]} py-1 text-xs tabular-nums`}>
        {r.cells.map((c, i) => <span key={i} className={`${i ? 'text-right' : ''} ${c.cls || 'text-slate-300'}`}>{c.text}</span>)}
      </div>
    ))}
  </div>
);

// Real paper-trading data: `account` is usePortfolio() (balance, holdings, trades); `prices` maps base symbol -> last
// futures price (P&L shows -- when the symbol is outside the overview).
const BottomStrip = ({ account, prices = {}, symbol, className = '' }) => {
  const [tab, setTab] = useState('positions');
  const { holdings = [], trades = [], error } = account || {};
  const { positions, history } = useMemo(() => ({
    positions: holdings.map((h) => {
      const px = prices[h.symbol];
      const pnl = Number.isFinite(px) ? (px - h.avgCost) * h.amount : null;
      return {
        key: h.symbol,
        cells: [
          { text: h.symbol, cls: 'text-slate-200' },
          { text: `${Number(h.amount.toFixed(6))} ${h.symbol}` },
          pnl === null
            ? { text: '--', cls: 'text-slate-500' }
            : { text: `${pnl >= 0 ? '+' : '-'}$${fmtPrice(Math.abs(pnl))}`, cls: pnl >= 0 ? 'text-emerald-400' : 'text-rose-400' },
        ],
      };
    }),
    history: trades.map((t) => ({
      key: t._id,
      cells: [
        { text: `${t.type === 'sell' ? 'Sell' : 'Buy'} ${t.cryptoSymbol}`, cls: t.type === 'sell' ? 'text-rose-400' : 'text-emerald-400' },
        { text: String(Number(t.amount.toFixed(6))) },
        { text: fmtPrice(t.priceAtTrade) },
        { text: new Date(t.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), cls: 'text-slate-500' },
      ],
    })),
  }), [holdings, trades, prices]);

  // Copilot stays mounted (hidden) so a billed brief survives tab switches.
  return (
    <Panel className={`${className} ${tab === 'ai' ? 'h-96' : 'h-56'}`} bodyClassName="min-h-0 overflow-auto p-3 pt-2">
      <div className="mb-2 flex items-center justify-between">
        <SegTabs tabs={TABS} active={tab} onChange={setTab} label="Account tables" className="-ml-2" />
        {tab !== 'ai' && error && <span className="text-[10px] text-rose-300">{error}</span>}
      </div>
      {tab === 'positions' && <Table tab="positions" head={['Symbol', 'Size', 'P&L']} rows={positions} empty="No open positions." />}
      {tab === 'history' && <Table tab="history" head={['Trade', 'Amount', 'Price', 'Time']} rows={history} empty="No trades yet." />}
      {symbol && <div className={tab === 'ai' ? '' : 'hidden'}><CopilotPanel symbol={symbol} className="border-0 bg-transparent" /></div>}
    </Panel>
  );
};

export default BottomStrip;
