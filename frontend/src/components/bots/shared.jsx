import React, { useCallback, useState } from 'react';
import { errText } from '../../lib/api';

// Money from the bots API is integer cents; null/undefined means unavailable, never zero.
export const usd = (c) => (typeof c === 'number' && Number.isFinite(c) ? `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--');
export const sUsd = (c) => (typeof c === 'number' && Number.isFinite(c) ? `${c > 0 ? '+' : ''}${usd(c)}` : '--');
export const dollars = (v) => (typeof v === 'number' && Number.isFinite(v) ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '--');
export const num = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 10 ** d) / 10 ** d) : '--');

// Cached create responses (describe, backtest, worst case): the API only returns them from POST /api/bots.
export const createdCache = new Map();

export const STATUS_STYLE = {
  proposed: 'border-amber-400/50 bg-amber-400/10 text-amber-300',
  running: 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300',
  paused: 'border-slate-500/60 bg-slate-500/10 text-slate-300',
  stopped: 'border-slate-600 bg-slate-800/60 text-slate-400',
  killed: 'border-rose-400/50 bg-rose-400/10 text-rose-300',
  declined: 'border-slate-600 bg-slate-800/60 text-slate-500',
};
export const StatusBadge = ({ status }) => (
  <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[status] || STATUS_STYLE.stopped}`}>{String(status)}</span>
);

// One plain-language line per state. A paused bot that never started is "accepted, ready to start".
export const statusLine = (bot) => ({
  proposed: 'Proposed: waiting for your approval',
  running: 'Running',
  paused: bot.startedAt ? 'Paused' : 'Accepted: ready to start',
  stopped: 'Stopped',
  killed: 'Killed: daily loss limit hit',
  declined: 'Declined',
}[bot.status] || String(bot.status));

export const btn = 'focus-ring inline-flex min-h-[44px] items-center justify-center rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50';
export const btnNeutral = `${btn} border-slate-700 text-slate-200 hover:bg-slate-900`;
export const btnGo = `${btn} border-cyan-400/60 text-cyan-200 hover:bg-cyan-400/10`;
export const btnDanger = `${btn} border-rose-400/60 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20`;

// Runs an async action once at a time; keeps its error text for display.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e?.response?.data?.code || errText(e)); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, run, setError };
}

// Error codes from the bots API, in plain words.
export const CODE_TEXT = {
  BAD_STATE: 'The bot changed state. Reloaded; check its status and try again.',
  HASH_MISMATCH: 'The bot changed since this screen loaded. Review the new terms and accept again.',
  NOT_ACCEPTED: 'The bot needs a current acceptance before it can start.',
  RUNNING_LIMIT: 'Running-bot limit reached. Pause or stop another bot first.',
  BOT_LIMIT: 'Bot limit reached. Delete or decline an old bot first.',
  BOTS_DISABLED: 'Bots are disabled on this server.',
  SYMBOL_NOT_ALLOWED: 'That symbol is not allowed for bots.',
  STOP_REQUIRED: 'The strategy has no stop loss, so it cannot run as a bot.',
  STOP_BEYOND_LIQ: 'The stop is beyond the liquidation price at this leverage.',
  LOSS_BUDGET: 'One worst-case trade would exceed the daily loss limit. Open More actions, then Edit size and limits: raise the daily loss limit or lower the size.',
  LEVERAGE_LIMIT: 'Leverage is over a limit.',
  POSITION_LIMIT: 'Size is over the position limit.',
};
export const codeText = (e) => CODE_TEXT[e] || e;

export class RowBoundary extends React.Component {
  constructor(p) { super(p); this.state = { bad: false }; }
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch(e) { console.error('bot row failed', e); }
  render() {
    return this.state.bad
      ? <div role="alert" className="rounded-md border border-slate-800 p-2 text-xs text-slate-500">{this.props.label || 'This item'} could not be shown.</div>
      : this.props.children;
  }
}

export const Err = ({ children }) => (children ? <p role="alert" className="text-xs text-rose-400">{codeText(String(children))}</p> : null);

// Two-step button: first click asks, second click does it. Used for kill and delete.
export const Confirm = ({ label, question, yes, onConfirm, disabled, className }) => {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button type="button" disabled={disabled} onClick={() => setAsking(true)} className={className}>{label}</button>;
  return (
    <div role="alertdialog" aria-label={question} className="w-full space-y-2 rounded-md border border-rose-400/50 bg-rose-500/10 p-2 text-sm text-rose-100">
      <p>{question}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }} className={`${btnDanger} font-bold`}>{yes}</button>
        <button type="button" onClick={() => setAsking(false)} className={btnNeutral}>Cancel</button>
      </div>
    </div>
  );
};
