import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import useAgentStore from '../../store/agentStore';
import useStrategyStore from '../../store/strategyStore';
import { API, authed, errText } from '../../lib/api';

// Strategies tab: saved strategies with Show on chart (server evaluates) and Delete.
const StrategyList = () => {
  const token = useUserStore((s) => s.token);
  const ctx = useAgentStore((s) => s.ctx);
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => axios.get(`${API}/api/strategies`, authed(token))
    .then((r) => setItems(Array.isArray(r.data) ? r.data : r.data?.strategies || []))
    .catch((e) => setErr(errText(e))), [token]);
  useEffect(() => { load(); }, [load]);

  const del = (id) => axios.delete(`${API}/api/strategies/${id}`, authed(token))
    .then(() => setItems((l) => l.filter((s) => (s._id || s.id) !== id)))
    .catch((e) => setErr(errText(e)));

  const show = (s) => {
    const id = s._id || s.id;
    const allTf = s.allTimeframes !== false; // old documents have no flag: all timeframes
    const evalOn = allTf ? ctx.interval || s.spec.timeframe : s.spec.timeframe;
    const body = { strategyId: id, kind: ctx.kind, symbol: ctx.symbol, interval: evalOn };
    return axios.post(`${API}/api/strategies/evaluate`, body, authed(token))
      .then((r) => { useStrategyStore.getState().setActive({ spec: s.spec, symbol: ctx.symbol, kind: ctx.kind, interval: s.spec.timeframe, allTimeframes: allTf, result: r.data, resultInterval: evalOn }); setErr(null); })
      .catch((e) => setErr(errText(e)));
  };

  if (items === null && !err) return <p className="p-4 text-sm text-slate-400" role="status">Loading strategies</p>;
  return (
    <div className="space-y-2 p-4">
      {err && <p role="alert" className="text-sm text-rose-400">{err}</p>}
      {items?.length === 0 && <p className="text-sm text-slate-400">No saved strategies yet. Ask the AI to create one in Chat.</p>}
      {items?.map((s) => {
        const id = s._id || s.id;
        return (
          <div key={id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-2 text-sm">
            <span className="min-w-0 truncate text-slate-200">{s.name} <span className="text-xs text-slate-500">{s.allTimeframes === false ? `pinned to ${s.spec?.timeframe}` : 'all timeframes'}</span></span>
            <span className="flex shrink-0 gap-1.5">
              <button type="button" disabled={!ctx} onClick={() => show(s)} className="focus-ring rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-50">Show on chart</button>
              <button type="button" aria-label={`Delete ${s.name}`} onClick={() => del(id)} className="focus-ring rounded-md border border-rose-400/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-400/10">Delete</button>
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default StrategyList;
