import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import useAgentStore from '../../store/agentStore';
import { API, authed } from '../../lib/api';
import AgentChat from './AgentChat';
import StrategyList from './StrategyList';

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

// History: past conversations for this user, open one or delete it.
const History = () => {
  const token = useUserStore((s) => s.token);
  const [list, setList] = useState(null);
  useEffect(() => {
    axios.get(`${API}/api/ai/agent/conversations`, authed(token)).then((r) => setList(Array.isArray(r.data) ? r.data : r.data?.conversations || [])).catch(() => setList([]));
  }, [token]);
  const openConv = (c) => axios.get(`${API}/api/ai/agent/conversations/${c._id || c.id}`, authed(token)).then((r) => {
    const d = r.data?.conversation || r.data;
    useAgentStore.getState().openConv({ conversationId: d._id || d.id, scope: d.scope || c.scope, messages: (d.messages || []).map((m) => ({ role: m.role, text: m.text, reply: m.strategy ? { strategy: m.strategy, sources: [] } : undefined })) });
  }).catch(() => {});
  const del = (c) => axios.delete(`${API}/api/ai/agent/conversations/${c._id || c.id}`, authed(token)).then(() => {
    setList((l) => l.filter((x) => x !== c));
    if (useAgentStore.getState().conversationId === (c._id || c.id)) useAgentStore.getState().reset();
  }).catch(() => {});
  if (!list?.length) return null;
  return (
    <details className="border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
      <summary className="cursor-pointer">History ({list.length})</summary>
      <ul className="mt-1 space-y-1">
        {list.map((c) => (
          <li key={c._id || c.id} className="flex justify-between gap-2">
            <button type="button" onClick={() => openConv(c)} className="min-w-0 truncate text-left text-slate-200 hover:underline">{c.title || c.scope}</button>
            <button type="button" aria-label={`Delete conversation ${c.title || c.scope}`} onClick={() => del(c)} className="text-rose-300 hover:underline">Delete</button>
          </li>
        ))}
      </ul>
    </details>
  );
};

// Right-side drawer, mounted once in Layout. Esc closes; focus returns to whatever opened it.
const AgentDock = () => {
  const open = useAgentStore((s) => s.open);
  const close = useAgentStore((s) => s.close);
  const tab = useAgentStore((s) => s.tab);
  const setTab = useAgentStore((s) => s.setTab);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    ref.current?.querySelector('textarea')?.focus();
    return () => { if (prev?.isConnected) prev.focus(); };
  }, [open]);

  if (!open) return null;
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const els = [...ref.current.querySelectorAll(FOCUSABLE)].filter((x) => !x.disabled);
    if (!els.length) return;
    const [first, last] = [els[0], els[els.length - 1]];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="AI analyst"
      onKeyDown={onKeyDown}
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-slate-800 bg-[#070b14] text-slate-200 shadow-2xl sm:w-[420px]"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <div role="tablist" aria-label="AI analyst" className="flex gap-1">
          {[['chat', 'Chat'], ['strategies', 'Strategies']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`focus-ring rounded-md px-2 py-1 text-sm font-medium ${tab === id ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>
          ))}
        </div>
        <button type="button" aria-label="Close AI analyst" onClick={close} className="focus-ring rounded-md px-2 py-1 text-slate-400 hover:text-slate-100">✕</button>
      </div>
      {tab === 'chat' ? <><History /><AgentChat /></> : <div className="min-h-0 flex-1 overflow-y-auto"><StrategyList /></div>}
    </div>
  );
};

export default AgentDock;
