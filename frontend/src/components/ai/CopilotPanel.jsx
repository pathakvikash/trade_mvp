import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Panel from '../ui/Panel';
import useUserStore from '../../store/userStore';
import { API, authed, errStatus, errText } from '../../lib/api';
import { fmtPrice } from '../ui/fmt';

export const NOT_CONFIGURED = 'AI is not configured. The server needs an Anthropic API key in backend/.env as ANTHROPIC_API_KEY.';

// Maps a failed AI call to {unconfigured, msg}.
export const aiError = (e) => {
  const s = errStatus(e);
  if (s === 503) return { unconfigured: true, msg: NOT_CONFIGURED };
  if (s === 429) return { msg: 'Rate limited. Wait a moment and try again.' };
  if (s === 422) return { msg: 'The assistant declined this request.' };
  if (s >= 500) return { msg: 'The AI service failed. Try again.' };
  if (s === 401) return { msg: errText(e) };
  return { msg: errText(e) };
};

// Shared by Copilot and Alerts: null = unknown/loading, false = not configured, true = ready.
export function useAiConfigured() {
  const token = useUserStore((s) => s.token);
  const [ok, setOk] = useState(null);
  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    axios.get(`${API}/api/ai/status`, authed(token))
      .then((r) => live && setOk(Boolean(r.data?.configured)))
      .catch(() => live && setOk(null)); // endpoint missing/down: let the real call report it
    return () => { live = false; };
  }, [token]);
  return [ok, setOk];
}

const BIAS = { bullish: 'text-emerald-400 border-emerald-400/40', bearish: 'text-rose-400 border-rose-400/40', neutral: 'text-slate-300 border-slate-600', mixed: 'text-amber-400 border-amber-400/40' };
const Chip = ({ cls, children }) => <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>{children}</span>;
const Label = ({ children }) => <h3 className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">{children}</h3>;
const Btn = (p) => <button type="button" {...p} className="focus-ring rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-900 disabled:opacity-50" />;

const CopilotPanel = ({ symbol, className = '' }) => {
  const token = useUserStore((s) => s.token);
  const [configured, setConfigured] = useAiConfigured();
  // Results are kept per symbol so an in-flight paid request still lands (and shows) if the symbol changes meanwhile.
  const [briefs, setBriefs] = useState({});
  const [busyMap, setBusyMap] = useState({});
  const [errState, setErrState] = useState(null); // { sym, msg }
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState([]);
  const [askErrState, setAskErrState] = useState(null); // { sym, msg }
  const brief = briefs[symbol];
  const busy = Boolean(busyMap[symbol]);
  const err = errState?.sym === symbol ? errState.msg : null;
  const askErr = askErrState?.sym === symbol ? askErrState.msg : null;

  const fail = (e, set) => {
    const r = aiError(e);
    if (r.unconfigured) setConfigured(false);
    set(r.msg);
  };

  const generate = async () => {
    const sym = symbol;
    setBusyMap((m) => ({ ...m, [sym]: true }));
    setErrState(null);
    try {
      const r = await axios.get(`${API}/api/ai/brief/${encodeURIComponent(sym)}`, authed(token));
      setBriefs((m) => ({ ...m, [sym]: r.data }));
    } catch (e) {
      fail(e, (msg) => setErrState({ sym, msg }));
    }
    setBusyMap((m) => ({ ...m, [sym]: false }));
  };

  const ask = async (ev) => {
    ev.preventDefault();
    const question = q.trim();
    if (question.length < 3 || question.length > 500 || asking) return;
    const sym = symbol;
    setAsking(true);
    setAskErrState(null);
    try {
      const r = await axios.post(`${API}/api/ai/ask`, { symbol: sym, question }, authed(token));
      setQa((a) => [{ sym, question, answer: String(r.data?.answer ?? '') }, ...a].slice(0, 5));
      setQ('');
    } catch (e) {
      fail(e, (msg) => setAskErrState({ sym, msg }));
    }
    setAsking(false);
  };

  const b = brief?.brief;
  const off = configured === false;

  return (
    <Panel
      title={`AI Copilot · ${symbol}`}
      className={className}
      bodyClassName="min-h-0 overflow-auto p-3"
      right={
        <Btn onClick={generate} disabled={busy || off}>
          {busy ? 'Generating...' : b ? 'Refresh' : 'Generate brief'}
        </Btn>
      }
    >
      {off && <p className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 text-sm text-amber-400" role="alert">{NOT_CONFIGURED}</p>}
      {err && !off && (
        <p className="mb-2 flex items-center justify-between gap-2 text-sm text-amber-400" role="alert">
          <span>{err}</span><Btn onClick={generate}>Retry</Btn>
        </p>
      )}
      {!b && !busy && !err && !off && <p className="text-sm text-slate-400">Generate a short AI read of {symbol} from live market data. Each brief is a billed call, so it only runs when you ask.</p>}

      {b && (
        <div className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Chip cls={BIAS[b.bias] || BIAS.neutral}>{b.bias}</Chip>
            <Chip cls="border-slate-600 text-slate-300">{b.confidence} confidence</Chip>
          </div>
          <p className="mt-2 font-semibold text-slate-100">{b.headline}</p>
          <p className="mt-1 text-slate-300">{b.summary}</p>
          {b.drivers?.length > 0 && <><Label>Drivers</Label><ul className="mt-1 space-y-1">{b.drivers.map((d, i) => <li key={i}><span className="text-slate-200">{d.label}</span> <span className="text-slate-400">{d.detail}</span></li>)}</ul></>}
          {b.risks?.length > 0 && <><Label>Risks</Label><ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-400">{b.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
          {b.watch?.length > 0 && <><Label>Watch levels</Label><ul className="mt-1 space-y-0.5">{b.watch.map((w, i) => <li key={i}><span className="tabular-nums text-cyan-400">{fmtPrice(Number(w.price))}</span> <span className="text-slate-400">{w.note}</span></li>)}</ul></>}
          <p className="mt-3 text-[11px] text-slate-500">Generated {new Date(brief.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by {brief.model}</p>
        </div>
      )}

      <Label>Ask about this market</Label>
      <form onSubmit={ask} className="mt-1 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          disabled={off}
          placeholder="e.g. Is funding stretched?"
          aria-label={`Ask about ${symbol}`}
          className="focus-ring min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
        />
        <Btn type="submit" disabled={off || asking || q.trim().length < 3}>{asking ? 'Asking...' : 'Ask'}</Btn>
      </form>
      {askErr && !off && <p className="mt-1 text-sm text-amber-400" role="alert">{askErr}</p>}
      <ul className="mt-2 space-y-2">
        {qa.filter((x) => x.sym === symbol).map((x, i) => (
          <li key={i} className="text-sm">
            <p className="text-slate-400">{x.question}</p>
            <p className="whitespace-pre-wrap text-slate-200">{x.answer}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-500">AI summary of market data. Not financial advice.</p>
    </Panel>
  );
};

export default CopilotPanel;
