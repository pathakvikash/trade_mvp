import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useSearchParams } from 'react-router-dom';
import usePolling from '../lib/usePolling';
import useUserStore from '../store/userStore';
import { API, authed } from '../lib/api';
import Skeleton from '../components/ui/Skeleton';
import Panel from '../components/ui/Panel';
import BotList from '../components/bots/BotList';
import BotDetail from '../components/bots/BotDetail';
import useAgentStore from '../store/agentStore';
import { btnDanger, btnGo, btnNeutral, Err, RowBoundary, useAction } from '../components/bots/shared';

const LIST_MS = 5000;

// Stop-all kill switch: two steps so it is hard to hit by accident, one POST.
const StopAll = ({ count, onDone }) => {
  const token = useUserStore((s) => s.token);
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction();
  const go = () => run(async () => { await axios.post(`${API}/api/bots/stop-all`, undefined, authed(token)); setAsking(false); onDone(); });
  if (!asking) return <button type="button" onClick={() => setAsking(true)} disabled={!count} className={`${btnDanger} font-bold`}>Stop all bots</button>;
  return (
    <div role="alertdialog" aria-label="Confirm stop all bots" className="space-y-2 rounded-md border border-rose-400/50 bg-rose-500/10 p-2 text-sm text-rose-100">
      <p>Stop every running and paused bot and close their open positions?</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={go} className={`${btnDanger} font-bold`}>Yes, stop all bots</button>
        <button type="button" disabled={busy} onClick={() => setAsking(false)} className={btnNeutral}>Cancel</button>
      </div>
      <Err>{error}</Err>
    </div>
  );
};

// Opens the AI dock on its Strategies tab (needs a context; default to BTC when no chart set one).
const openStrategies = () => {
  const st = useAgentStore.getState();
  st.setTab('strategies');
  st.openWith(st.ctx || { kind: 'perp', symbol: 'BTCUSDT', page: 'bots' });
};

const Empty = () => (
  <div className="space-y-3 text-sm text-slate-300">
    <h3 className="font-medium text-slate-100">How bots work</h3>
    <ol className="list-decimal space-y-1 pl-5 text-slate-400">
      <li>Pick a strategy in the AI panel and press Create bot. It starts as a proposal; nothing runs.</li>
      <li>Read the plain-English terms here, tick the box and Accept.</li>
      <li>Press Start. The bot trades paper money only and logs every decision. Kill it any time.</li>
    </ol>
    <button type="button" onClick={openStrategies} className={btnGo}>Open AI panel: Strategies</button>
  </div>
);

const Bots = () => {
  const token = useUserStore((s) => s.token);
  const [params, setParams] = useSearchParams();
  const [kick, setKick] = useState(0);
  const cfgP = usePolling(`${API}/api/bots/config`, 60000, undefined, token, true);
  const listP = usePolling(`${API}/api/bots`, LIST_MS, kick || undefined, token, true);
  const cfg = cfgP.data;
  const bots = Array.isArray(listP.data) ? listP.data.filter(Boolean) : [];
  const selectedId = params.get('bot');
  const selected = bots.find((b) => b._id === selectedId);
  const refresh = () => setKick((k) => k + 1);
  const select = (id) => setParams(id ? { bot: id } : {});
  const changed = (b) => { if (b === null) select(null); refresh(); };
  // arriving with ?bot=<new id> (e.g. Create bot while already on this page): the poll may not have it yet, fetch once
  const tried = useRef(null);
  useEffect(() => {
    if (selectedId && listP.data && !selected && tried.current !== selectedId) { tried.current = selectedId; refresh(); }
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = !!selectedId && !selected && (listP.loading || listP.fetching || tried.current !== selectedId);
  const active = bots.filter((b) => ['running', 'paused'].includes(b.status)).length;

  return (
    <div className="flex flex-col gap-3 xl:h-full xl:min-h-0 xl:overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">Bots</h1>
          <p className="text-xs text-slate-400">Paper money only. No funding is simulated and fills are optimistic, so real results would be worse. Not financial advice. Bots run only while the server is awake.</p>
        </div>
        <StopAll count={active} onDone={refresh} />
      </div>
      {cfg && cfg.botsEnabled === false && (
        <div role="alert" className="rounded-md border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">Bots are disabled on this server. You can review existing bots, but none can start.</div>
      )}
      {cfgP.error && !cfg && <p role="alert" className="text-xs text-amber-300">Bot settings unavailable, retrying.</p>}
      <div className="grid gap-3 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Panel title="Your bots" className={`self-start ${selectedId ? 'hidden xl:flex' : ''}`}>
          {listP.loading && <div role="status" aria-label="Loading bots" className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
          {listP.error && !listP.data && <p role="alert" className="text-sm text-rose-400">Could not load bots, retrying.</p>}
          {listP.data && !bots.length && <Empty />}
          {bots.length > 0 && <BotList bots={bots} selectedId={selectedId} onSelect={select} onChanged={changed} />}
        </Panel>
        <div className={`min-w-0 ${selectedId ? '' : 'hidden xl:block'}`}>
          {selectedId && <button type="button" onClick={() => select(null)} className={`${btnNeutral} mb-3 xl:hidden`}>← Back to bots</button>}
          {selected
            ? <RowBoundary key={selected._id} label="This bot"><BotDetail bot={selected} cfg={cfg} onChanged={changed} /></RowBoundary>
            : waiting
              ? <div role="status" aria-label="Loading bot" className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
              : <p className="rounded-xl border border-slate-800/80 p-4 text-sm text-slate-500">{selectedId ? 'That bot was not found.' : 'Select a bot to see its decisions and performance.'}</p>}
        </div>
      </div>
    </div>
  );
};

export default Bots;
