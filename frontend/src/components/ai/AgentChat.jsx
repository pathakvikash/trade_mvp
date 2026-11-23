import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import useUserStore from '../../store/userStore';
import useAgentStore from '../../store/agentStore';
import useStrategyStore from '../../store/strategyStore';
import { API, authed, errStatus } from '../../lib/api';
import { aiError } from './CopilotPanel';
import StrategyCard from './StrategyCard';

export const DISCLAIMER = 'Analysis only, not financial advice. Paper trading.';
const NO_KEY = ['ai_no_key', 'ai_not_configured', 'ai_unconfigured'];
const PAGES = { trade: 'Trade', derivatives: 'Derivatives', liquidation: 'Liquidation', markets: 'Markets' };
const chipText = (c) => [c.symbol, PAGES[c.page] || c.page, c.interval].filter(Boolean).join(' · ');

const Sources = ({ sources = [] }) => (
  <ul aria-label="Sources" className="mt-2 flex flex-wrap gap-1">
    {sources.map((s, i) => (
      <li key={i} className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
        {s.section}: {s.source}{s.asOf ? ` ${s.asOf}` : ''}
        {s.estimate && <b className="ml-1 text-amber-400">estimate</b>}
        {s.delayed && <b className="ml-1 text-amber-400">delayed</b>}
      </li>
    ))}
  </ul>
);

const Reply = ({ m, ctx }) => {
  const token = useUserStore((s) => s.token);
  const [note, setNote] = useState(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = m.reply;
  const st = r?.strategy;

  const show = () => {
    setBusy(true);
    const body = { spec: st.spec, kind: ctx.kind, symbol: ctx.symbol, interval: ctx.interval || '1h' };
    axios.post(`${API}/api/strategies/evaluate`, body, authed(token))
      .then((x) => { useStrategyStore.getState().setActive({ spec: st.spec, symbol: ctx.symbol, kind: ctx.kind, interval: body.interval, result: x.data }); setNote(null); })
      .catch((e) => setNote(aiError(e).msg)).finally(() => setBusy(false));
  };
  const save = () => {
    setBusy(true);
    axios.post(`${API}/api/strategies`, { name: st.describe.slice(0, 60), spec: st.spec, symbol: ctx.symbol, origin: 'ai' }, authed(token))
      .then(() => setNote('Saved.'))
      .catch((e) => setNote(e?.response?.data?.error === 'STRATEGY_LIMIT' || errStatus(e) === 409 ? 'You have reached the saved-strategy limit. Delete one in the Strategies tab first.' : aiError(e).msg))
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-200">
      <p className="whitespace-pre-wrap break-words">{m.text}</p>
      {r?.strategyDropped && <p className="mt-2 text-xs text-amber-300">The strategy the AI proposed was invalid and was dropped.</p>}
      {st && !gone && <StrategyCard strategy={st} busy={busy} note={note} onShow={show} onSave={save} onDiscard={() => setGone(true)} />}
      {r?.dataGaps?.length > 0 && <p className="mt-2 text-xs text-slate-500">Missing data: {r.dataGaps.map(String).join(', ')}</p>}
      <Sources sources={r?.sources} />
    </div>
  );
};

const AgentChat = () => {
  const token = useUserStore((s) => s.token);
  const includes = useUserStore((s) => s.user?.ai?.includePortfolio === true);
  const { ctx, messages, loading, error, conversationId } = useAgentStore();
  const [text, setText] = useState('');
  const [wantStrategy, setWant] = useState(false);
  const close = useAgentStore((s) => s.close);
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [messages, loading]);

  const send = () => {
    const message = text.trim();
    if (!message || loading || !ctx) return;
    const { patch } = useAgentStore.getState();
    patch({ messages: [...messages, { role: 'user', text: message }], loading: true, error: null });
    setText('');
    const body = { conversationId: conversationId || undefined, context: ctx, message, ...(wantStrategy ? { wantStrategy: true } : {}) };
    const ctl = useAgentStore.getState().beginChat();
    axios.post(`${API}/api/ai/agent/chat`, body, { ...authed(token), signal: ctl.signal })
      .then((r) => {
        if (ctl.signal.aborted) return;
        const d = r.data;
        patch({ conversationId: d.conversationId, loading: false, messages: [...useAgentStore.getState().messages, { role: 'assistant', text: d.reply?.text ?? '', reply: d.reply }] });
      })
      .catch((e) => {
        if (ctl.signal.aborted) return;
        const code = e?.response?.data?.error;
        const a = aiError(e);
        patch({ loading: false, error: NO_KEY.includes(code) || a.unconfigured ? { unconfigured: true } : { msg: errStatus(e) === 429 ? 'Rate limited. Wait a minute and try again.' : a.msg } });
      });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-2 text-xs">
        {ctx && <span className="rounded-full border border-brand-500/40 px-2 py-0.5 text-brand-400">{chipText(ctx)}</span>}
        {!includes && <span className="text-slate-500">Portfolio not included. <Link to="/settings/security" onClick={close} className="text-cyan-400 hover:underline">Include my portfolio</Link></span>}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-sm text-slate-500">Ask about this market. The AI sees the data on this page; it cannot place orders.</p>}
        {messages.map((m, i) => m.role === 'user'
          ? <p key={i} className="ml-8 whitespace-pre-wrap break-words rounded-lg bg-brand-500/15 p-2 text-sm text-slate-100">{m.text}</p>
          : <Reply key={i} m={m} ctx={ctx} />)}
        {loading && <p role="status" className="text-sm text-slate-400">Thinking</p>}
        {error?.unconfigured && (
          <div role="alert" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
            AI is not configured. <Link to="/settings/ai" onClick={close} className="underline">Add a key in Settings &gt; AI</Link>.
          </div>
        )}
        {error?.msg && <p role="alert" className="text-sm text-rose-400">{error.msg}</p>}
        <div ref={end} />
      </div>
      <div className="border-t border-slate-800 p-3">
        <label className="mb-2 flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={wantStrategy} onChange={(e) => setWant(e.target.checked)} /> Create a strategy
        </label>
        <div className="flex gap-2">
          <textarea
            aria-label="Message"
            rows={2}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            className="w-full resize-none rounded-xl border border-slate-700/70 bg-slate-950/80 px-3 py-2 text-base text-slate-100 outline-none focus:border-brand-500 sm:text-sm"
          />
          <button type="button" onClick={send} disabled={loading || !text.trim()} className="focus-ring rounded-xl bg-brand-500 px-3 text-sm font-medium text-white disabled:opacity-50">Send</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{DISCLAIMER}</p>
      </div>
    </div>
  );
};

export default AgentChat;
