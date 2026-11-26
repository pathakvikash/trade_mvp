import React, { useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import Panel from '../ui/Panel';
import BotAccept from './BotAccept';
import BotPerformance from './BotPerformance';
import DecisionFeed from './DecisionFeed';
import useScrollIntoView from '../../lib/useScrollIntoView';
import { btnDanger, btnGo, btnNeutral, Confirm, dollars, Err, num, StatusBadge, statusLine, useAction, usd } from './shared';

const field = 'focus-ring min-h-[44px] w-full rounded-md border border-slate-700 bg-slate-900 px-2 text-sm text-slate-100';

// Module scope on purpose: a component defined inside LimitsForm remounts its input on every keystroke.
const F = ({ k, label, hint, v, set, busy }) => (
  <label className="block text-xs text-slate-400">{label}
    <input type="number" inputMode="decimal" step="any" className={field} value={v[k] ?? ''} onChange={set(k)} disabled={busy} />
    {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
  </label>
);

// Edit size / leverage / limits. Any save clears the acceptance (server: back to Proposed), so say so up front.
const LimitsForm = ({ bot, cfg, onSaved, onCancel }) => {
  const token = useUserStore((s) => s.token);
  const { busy, error, run } = useAction();
  const L = bot.limits || {};
  const [v, setV] = useState({ sizeUsd: bot.sizeUsd, leverage: bot.leverage, dailyLossUsd: L.dailyLossUsd, maxTradesPerDay: L.maxTradesPerDay, maxPositionUsd: L.maxPositionUsd, maxLeverage: L.maxLeverage });
  const caps = cfg?.caps || {};
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = (e) => {
    e.preventDefault();
    const n = (k) => Number(v[k]);
    run(async () => {
      const body = { sizeUsd: n('sizeUsd'), leverage: n('leverage'), limits: { dailyLossUsd: n('dailyLossUsd'), maxTradesPerDay: n('maxTradesPerDay'), maxPositionUsd: n('maxPositionUsd'), maxLeverage: n('maxLeverage') } };
      onSaved((await axios.put(`${API}/api/bots/${bot._id}`, body, authed(token))).data);
    });
  };
  return (
    <form onSubmit={save} className="space-y-2" aria-label="Edit limits">
      <p role="note" className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">Saving any change clears your acceptance. The bot goes back to Proposed and must be reviewed and accepted again before it can start.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <F v={v} set={set} busy={busy} k="sizeUsd" label="Position size (USD)" hint={`max ${dollars(caps.MAX_SIZE_USD)}`} />
        <F v={v} set={set} busy={busy} k="leverage" label="Leverage (x)" hint={`1 to ${caps.MAX_LEVERAGE ?? '--'}`} />
        <F v={v} set={set} busy={busy} k="dailyLossUsd" label="Daily loss limit (USD)" hint="kill switch: the bot stops when this is reached" />
        <F v={v} set={set} busy={busy} k="maxTradesPerDay" label="Max trades per day" hint="1 to 100" />
        <F v={v} set={set} busy={busy} k="maxPositionUsd" label="Max position (USD)" hint="at least the size" />
        <F v={v} set={set} busy={busy} k="maxLeverage" label="Max leverage (x)" hint="at least the leverage" />
      </div>
      <Err>{error}</Err>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={btnGo}>Save and clear acceptance</button>
        <button type="button" disabled={busy} onClick={onCancel} className={btnNeutral}>Cancel</button>
      </div>
    </form>
  );
};

// 1 Review terms -> 2 Accept -> 3 Start. A bot that ever started has finished all three.
const STEPS = ['Review terms', 'Accept', 'Start'];
const stepOf = (b) => (b.status === 'proposed' ? 0 : b.status === 'paused' && !b.startedAt ? 2 : 3);
const Steps = ({ bot }) => {
  if (bot.status === 'declined') return null;
  const cur = stepOf(bot);
  return (
    <ol aria-label="Progress" className="grid grid-cols-3 gap-1 text-[11px] sm:text-xs">
      {STEPS.map((t, i) => (
        <li key={t} aria-current={i === cur ? 'step' : undefined} className={`rounded-md border px-2 py-1 text-center ${i < cur ? 'border-emerald-400/40 text-emerald-300' : i === cur ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200' : 'border-slate-800 text-slate-500'}`}>
          {i < cur ? '✓ ' : `${i + 1} `}{t}
        </li>
      ))}
    </ol>
  );
};

// One obvious primary action per state (Start or Pause). Kill is always visible and needs a confirm.
const Controls = ({ bot, enabled, onChanged }) => {
  const token = useUserStore((s) => s.token);
  const { busy, error, run } = useAction();
  const post = (path, msg) => run(async () => onChanged((await axios.post(`${API}/api/bots/${bot._id}/${path}`, undefined, authed(token))).data, msg));
  const s = bot.status;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {s === 'paused' && <button type="button" disabled={busy || !enabled || !bot.accepted} onClick={() => post('start', 'Started. Decisions appear below.')} className={`${btnGo} bg-cyan-400/10 font-bold`}>Start</button>}
        {s === 'running' && <button type="button" disabled={busy} onClick={() => post('pause', 'Paused.')} className={`${btnGo} bg-cyan-400/10 font-bold`}>Pause</button>}
        {(s === 'running' || s === 'paused') && (
          <Confirm label="Kill: stop bot and close its position" question="Stop this bot and close its open position now?" yes="Yes, kill bot" disabled={busy} className={`${btnDanger} font-bold`} onConfirm={() => post('stop', 'Stopped. Its position was closed.')} />
        )}
      </div>
      {s === 'paused' && !bot.accepted && <p className="text-xs text-amber-300">Acceptance is out of date: the bot cannot start. Edit, review and accept again.</p>}
      {s === 'paused' && bot.startedAt && <p className="text-xs text-slate-500">Paused: the bot takes no new actions; an open position stays, protected by its stop loss and take profit.</p>}
      <Err>{error}</Err>
    </div>
  );
};

// Secondary actions, de-emphasised behind a disclosure.
const More = ({ bot, editing, setEditing, onChanged }) => {
  const token = useUserStore((s) => s.token);
  const { busy, error, run } = useAction();
  const del = () => run(async () => { await axios.delete(`${API}/api/bots/${bot._id}`, authed(token)); onChanged(null); });
  const editable = ['proposed', 'paused'].includes(bot.status);
  if (bot.status === 'running') return null;
  return (
    <details className="rounded-md border border-slate-800 px-2">
      <summary className="focus-ring flex min-h-[44px] cursor-pointer items-center text-xs text-slate-400">More actions</summary>
      <div className="flex flex-wrap gap-2 pb-2">
        {editable && !editing && <button type="button" onClick={() => setEditing(true)} className={btnNeutral}>Edit size and limits</button>}
        <Confirm label="Delete" question="Delete this bot and its history? This cannot be undone." yes="Yes, delete" disabled={busy} className={btnNeutral} onConfirm={del} />
      </div>
      <Err>{error}</Err>
    </details>
  );
};

const BotDetail = ({ bot, cfg, onChanged }) => {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(null);
  const ref = useScrollIntoView(); // arriving from the AI panel: bring the accept screen to the top
  const L = bot.limits || {};
  // The list payload has no `today`: bot.day belongs to whichever UTC day the bot last traded, so ignore a stale one.
  const day = bot.today || bot.day || {};
  const today = bot.today || day.key === new Date().toISOString().slice(0, 10) ? day : {};
  const enabled = cfg?.botsEnabled !== false;
  const changed = (b, msg) => { if (msg) setNotice(msg); setEditing(false); onChanged(b); };
  return (
    <div ref={ref} className="min-w-0 scroll-mt-2 space-y-3">
      <Panel title={`${bot.name}`} right={<StatusBadge status={bot.status} />}>
        <div className="space-y-3 text-sm">
          <Steps bot={bot} />
          <p className="font-medium text-slate-100">{statusLine(bot)}</p>
          <p className="text-xs text-slate-400">{bot.symbol} perpetual, {bot.interval} candles, {dollars(bot.sizeUsd)} at {bot.leverage}x. Paper money.</p>
          {notice && <p role="status" className="rounded-md border border-emerald-400/40 bg-emerald-400/10 p-2 text-xs text-emerald-200">{notice}</p>}
          {bot.stopReason && <p className="text-xs text-amber-300">Stopped because: {String(bot.stopReason)}</p>}
          {bot.status === 'killed' && <p role="alert" className="text-xs text-rose-300">Killed by its daily loss limit. It will not restart by itself.</p>}
          {bot.status !== 'proposed' && !today.trades && <p className="text-xs text-slate-500">No trades today.</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            <div><dt className="text-slate-500">Today's trades</dt><dd className="text-slate-100">{num(today.trades || 0, 0)} of {num(L.maxTradesPerDay, 0)}</dd></div>
            <div><dt className="text-slate-500">Today's realized P&L</dt><dd className="text-slate-100">{usd(today.realizedCents || 0)} (limit -{dollars(L.dailyLossUsd)})</dd></div>
            <div><dt className="text-slate-500">Max position / leverage</dt><dd className="text-slate-100">{dollars(L.maxPositionUsd)} / {L.maxLeverage}x</dd></div>
          </dl>
          {!enabled && <p className="text-xs text-amber-300">Bots are disabled on this server, so this bot cannot start.</p>}
          {bot.status !== 'proposed' && <Controls bot={bot} enabled={enabled} onChanged={changed} />}
          {editing && <LimitsForm bot={bot} cfg={cfg} onSaved={(b) => changed(b, 'Saved. The bot is back to Proposed: review and accept it again.')} onCancel={() => setEditing(false)} />}
          <More bot={bot} editing={editing} setEditing={setEditing} onChanged={changed} />
        </div>
      </Panel>
      {bot.status === 'proposed' && <BotAccept bot={bot} cfg={cfg} onChanged={changed} />}
      {bot.status !== 'proposed' && bot.status !== 'declined' && (
        <>
          <BotPerformance botId={bot._id} />
          <Panel title="Decisions (live)"><DecisionFeed botId={bot._id} /></Panel>
        </>
      )}
    </div>
  );
};

export default BotDetail;
