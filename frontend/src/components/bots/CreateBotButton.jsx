import React, { useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';
import useUserStore from '../../store/userStore';
import useAgentStore from '../../store/agentStore';
import { API, authed } from '../../lib/api';
import { createdCache, codeText, useAction } from './shared';
import { clampPlan } from '../../lib/agentReply';

// "Create bot" on a strategy: reads the server's defaults, creates a PROPOSED bot (nothing runs), links to the accept screen.
// Pass strategyId for a saved strategy, or spec for an unsaved proposal.
// plan (optional, from an AI answer) pre-fills size and leverage, clamped to the server's hard caps.
const CreateBotButton = ({ strategyId, spec, name, plan }) => {
  const token = useUserStore((s) => s.token);
  const ctx = useAgentStore((s) => s.ctx);
  const { busy, error, run } = useAction();
  const [made, setMade] = useState(null);
  const navigate = useNavigate();
  // The dock is a fixed overlay: close it so the accept screen is readable, then land on the new bot.
  const goReview = (id) => { useAgentStore.getState().close(); navigate(`/bots?bot=${id}`); };

  const create = () => run(async () => {
    const cfg = (await axios.get(`${API}/api/bots/config`, authed(token))).data;
    if (cfg.botsEnabled === false) throw new Error('BOTS_DISABLED');
    const symbol = String(ctx?.symbol || '').replace(/USDT$/, '');
    if (!symbol || (cfg.symbols?.length && !cfg.symbols.includes(symbol))) throw new Error('Open a bot-eligible symbol on the chart first, then create the bot.');
    const tf = spec?.timeframe;
    if (tf && cfg.intervals && !cfg.intervals.includes(tf)) throw new Error(`Bots run on ${cfg.intervals.join(', ')} candles; this strategy was designed on ${tf}.`);
    const d = cfg.defaults || {};
    const body = { ...(strategyId ? { strategyId } : { spec }), symbol, ...{ sizeUsd: d.sizeUsd, leverage: d.leverage, ...clampPlan(plan, cfg.caps) }, limits: { dailyLossUsd: d.dailyLossUsd, maxTradesPerDay: d.maxTradesPerDay }, ...(name ? { name: String(name).slice(0, 60) } : {}) };
    const r = (await axios.post(`${API}/api/bots`, body, authed(token))).data;
    createdCache.set(String(r.bot._id), r);
    setMade(r.bot._id);
    goReview(r.bot._id);
  });

  return (
    <>
      <button type="button" disabled={busy || !!made} onClick={create} className="focus-ring min-h-[44px] rounded-md border border-emerald-400/50 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50">{made ? 'Bot created' : 'Create bot & review'}</button>
      {made && <span role="status" className="basis-full text-xs text-slate-400">Proposed only: nothing runs until you accept on the next screen. <Link to={`/bots?bot=${made}`} onClick={() => useAgentStore.getState().close()} className="focus-ring text-cyan-300 underline">Review and accept</Link></span>}
      {error && <span role="alert" className="basis-full text-xs text-rose-400">{codeText(error)}</span>}
    </>
  );
};

export default CreateBotButton;
