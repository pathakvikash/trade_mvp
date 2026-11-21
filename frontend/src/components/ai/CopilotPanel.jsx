import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import useUserStore from '../../store/userStore';
import { API, authed, errStatus, errText } from '../../lib/api';

export const REASONING_BUDGET = 'The model used its whole budget thinking; raise the token budget (LMSTUDIO_MAX_TOKENS) or use a shorter length.';
export const CONTEXT_TOO_SMALL = 'Context window too small: load the model with a larger context in LM Studio.';
export const NOT_CONFIGURED = 'AI is not configured. The server needs an Anthropic API key in backend/.env as ANTHROPIC_API_KEY.';
const MODEL_LABELS = { 'claude-opus-5-5': 'Opus 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-haiku-5-5': 'Haiku 5.5' };

// Maps a failed AI call to {unconfigured, msg}.
export const aiError = (e) => {
  const s = errStatus(e);
  const { error, detail } = e?.response?.data || {};
  if (error === 'ai_reasoning_budget') return { msg: REASONING_BUDGET };
  if (error === 'ai_context_too_small') return { msg: CONTEXT_TOO_SMALL };
  // detail: the local model server's own message (LM Studio only, capped at 200 chars by the backend)
  if (error === 'ai_upstream_error' && typeof detail === 'string' && detail) return { msg: `The local model server returned an error: ${detail}` };
  if (s === 503) return { unconfigured: true, msg: NOT_CONFIGURED };
  if (s === 429) return { msg: 'Rate limited. Wait a moment and try again.' };
  if (s === 422) return { msg: 'The assistant declined this request.' };
  if (s >= 500) return { msg: 'The AI service failed. Try again.' };
  if (s === 401) return { msg: errText(e) };
  return { msg: errText(e) };
};

// Shared by Copilot and Alerts: ok null = unknown/loading, false = not configured, true = ready.
// refetch() re-checks GET /api/ai/status; model is the signed-in user's effective model id (or null);
// provider is 'api' | 'cli' | null (cli = the local Claude Code login, development only).
export function useAiConfigured() {
  const token = useUserStore((s) => s.token);
  const [ok, setOk] = useState(null);
  const [model, setModel] = useState(null);
  const [provider, setProvider] = useState(null);
  const refetch = useCallback(() => {
    if (!token) return Promise.resolve();
    return axios.get(`${API}/api/ai/status`, authed(token))
      .then((r) => { setOk(Boolean(r.data?.configured)); setModel(r.data?.model || null); setProvider(r.data?.provider || null); })
      .catch(() => setOk(null)); // endpoint missing/down: let the real call report it
  }, [token]);
  useEffect(() => { refetch(); }, [refetch]);
  return [ok, setOk, refetch, model, provider];
}

const BIAS = { bullish: 'text-emerald-400 border-emerald-400/40', bearish: 'text-rose-400 border-rose-400/40', neutral: 'text-slate-300 border-slate-600', mixed: 'text-amber-400 border-amber-400/40' };
const Chip = ({ cls, children }) => <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}>{children}</span>;
const Label = ({ children }) => <h3 className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-500">{children}</h3>;
const Btn = (p) => <button type="button" {...p} className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-900 disabled:opacity-50" />;
const Spinner = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3 motion-safe:animate-spin" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
const Dots = () => (
  <span aria-hidden="true" className="inline-flex gap-1">
    {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-400 motion-safe:animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />)}
  </span>
);
const Skeleton = () => (
  <div role="status" className="text-sm">
    <span className="sr-only">Generating brief</span>
    <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
      <div className="h-4 w-3/4 rounded bg-slate-800" />
      <div className="space-y-2">
        <div className="h-3 w-full rounded bg-slate-800" />
        <div className="h-3 w-11/12 rounded bg-slate-800" />
        <div className="h-3 w-2/3 rounded bg-slate-800" />
      </div>
      <div className="flex gap-2">
        <div className="h-5 w-16 rounded bg-slate-800" />
        <div className="h-5 w-24 rounded bg-slate-800" />
      </div>
    </div>
  </div>
);
const CaseCard = ({ title, c, cls }) => (
  <div className={`rounded-lg border bg-slate-900/40 p-2 ${cls}`}>
    <p className="text-[11px] font-semibold uppercase tracking-wider">{title}</p>
    <ul className="mt-1 space-y-0.5 text-xs text-slate-300">
      <li><span className="text-slate-500">Entry </span>{c?.entry || '—'}</li>
      <li><span className="text-slate-500">Stop </span>{c?.invalidation || '—'}</li>
      <li><span className="text-slate-500">Target </span>{c?.target || '—'}</li>
    </ul>
  </div>
);
// Ask answers come back as "Label: text" lines (see aiService ASK_FORMAT): bold the label, bullets as list items.
const LABEL_RE = /^([A-Z][\w ()/-]{1,30}):\s*(.*)$/;
export const Answer = ({ text }) => (
  <div className="mt-1 space-y-1 text-slate-300">
    {String(text).split('\n').filter((l) => l.trim()).map((l, i) => {
      const bullet = /^\s*[-•*]\s+/.test(l);
      const m = !bullet && LABEL_RE.exec(l.trim());
      if (bullet) return <p key={i} className="pl-3 before:-ml-3 before:mr-1.5 before:content-['•']">{l.replace(/^\s*[-•*]\s+/, '')}</p>;
      if (m) return <p key={i}><span className="font-semibold text-slate-100">{m[1]}:</span> {m[2]}</p>;
      return <p key={i} className={/financial advice/i.test(l) ? 'text-[11px] text-slate-500' : ''}>{l}</p>;
    })}
  </div>
);
const SetupCard =({ onCheck, checking }) => (
  <div role="alert" className="mb-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-slate-200">
    <p className="font-semibold text-amber-300">Connect Claude to enable the Copilot</p>
    <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-300">
      <li>Create a key at console.anthropic.com.</li>
      <li>Add <code className="rounded bg-slate-900 px-1 text-xs text-cyan-300">ANTHROPIC_API_KEY=your-key</code> to backend/.env.</li>
      <li>Restart the backend.</li>
      <li>Or sign in with the Claude CLI (claude auth login) and restart the backend (development only).</li>
    </ol>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Btn onClick={onCheck} disabled={checking}>{checking && <Spinner />}Check again</Btn>
      <span className="text-[11px] text-slate-500">Nothing is billed until a key is added and you click a button.</span>
    </div>
  </div>
);

const CopilotPanel = ({ symbol, className = '' }) => {
  const token = useUserStore((s) => s.token);
  const [configured, setConfigured, refetch, model, provider] = useAiConfigured();
  // Results are kept per symbol so an in-flight paid request still lands (and shows) if the symbol changes meanwhile.
  const [briefs, setBriefs] = useState({});
  const [busyMap, setBusyMap] = useState({}); // sym -> start time (ms) while generating, else false
  const [now, setNow] = useState(() => Date.now());
  const [errState, setErrState] = useState(null); // { sym, msg }
  const [q, setQ] = useState('');
  const [askMap, setAskMap] = useState({}); // sym -> question in flight, else false
  const [qa, setQa] = useState([]);
  const [askErrState, setAskErrState] = useState(null); // { sym, msg }
  const [checking, setChecking] = useState(false);
  const brief = briefs[symbol];
  const started = busyMap[symbol];
  const busy = Boolean(started);
  const pending = askMap[symbol] || null;
  const err = errState?.sym === symbol ? errState.msg : null;
  const askErr = askErrState?.sym === symbol ? askErrState.msg : null;
  const off = configured === false;

  // Live elapsed counter: ticks only while a brief is generating.
  useEffect(() => {
    if (!busy) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);
  const elapsed = busy ? Math.max(0, Math.floor((now - started) / 1000)) : 0;

  const fail = (e, set) => {
    const r = aiError(e);
    if (r.unconfigured) setConfigured(false);
    set(r.msg);
  };

  // Not configured: the setup card is already on screen, so a click only re-checks the key (no billed call).
  const check = async () => {
    setChecking(true);
    await refetch();
    setChecking(false);
  };

  const generate = async () => {
    if (off) return check();
    const sym = symbol;
    setBusyMap((m) => ({ ...m, [sym]: Date.now() }));
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
    if (off) return check();
    const question = q.trim();
    if (question.length < 3 || question.length > 500 || askMap[symbol]) return;
    const sym = symbol;
    setAskMap((m) => ({ ...m, [sym]: question }));
    setAskErrState(null);
    try {
      const r = await axios.post(`${API}/api/ai/ask`, { symbol: sym, question }, authed(token));
      setQa((a) => [{ sym, question, answer: String(r.data?.answer ?? '') }, ...a].slice(0, 5));
      setQ('');
    } catch (e) {
      fail(e, (msg) => setAskErrState({ sym, msg }));
    }
    setAskMap((m) => ({ ...m, [sym]: false }));
  };

  const b = brief?.brief;

  return (
    <Panel
      title={`AI Copilot · ${symbol}`}
      className={className}
      bodyClassName="min-h-0 overflow-y-auto overscroll-contain p-3"
      right={
        <Btn onClick={generate} disabled={busy} aria-busy={busy}>
          {busy ? <><Spinner />{`Analyzing live data… ${elapsed}s`}</> : b ? 'Refresh' : 'Generate brief'}
        </Btn>
      }
    >
      {provider === 'cli' && <p className="mb-1 text-[11px] text-amber-400">Using your Claude account via the local CLI (dev only)</p>}
      {model && (
        <p className="mb-2 text-[11px] text-slate-500">
          Model: {MODEL_LABELS[model] || model} · <Link to="/settings" className="text-cyan-400 underline-offset-2 hover:underline">change in Settings</Link>
        </p>
      )}
      {off && <SetupCard onCheck={check} checking={checking} />}
      {err && !off && (
        <p className="mb-2 flex items-center justify-between gap-2 text-sm text-amber-400" role="alert">
          <span>{err}</span><Btn onClick={generate}>Retry</Btn>
        </p>
      )}
      {!b && !busy && !err && !off && <p className="text-sm text-slate-400">Generate a short AI read of {symbol} from live market data. Each brief is a billed call, so it only runs when you ask.</p>}

      {busy && <Skeleton />}
      {!busy && b && (
        <div className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Chip cls={BIAS[b.bias] || BIAS.neutral}>{b.bias}</Chip>
            <Chip cls="border-slate-600 text-slate-300">{b.confidence} confidence</Chip>
          </div>
          <p className="mt-2 font-semibold text-slate-100">{b.headline}</p>
          <dl className="mt-2 space-y-1">
            {b.shortTerm && <div><dt className="inline font-semibold text-slate-200">Short-term (hours): </dt><dd className="inline text-slate-300">{b.shortTerm}</dd></div>}
            {b.longTerm && <div><dt className="inline font-semibold text-slate-200">Long-term (days-weeks): </dt><dd className="inline text-slate-300">{b.longTerm}</dd></div>}
          </dl>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <CaseCard title="Long case" c={b.long} cls="border-emerald-400/30 text-emerald-400" />
            <CaseCard title="Short case" c={b.short} cls="border-rose-400/30 text-rose-400" />
          </div>
          {b.invalidation && <p className="mt-2"><span className="font-semibold text-slate-200">Invalidation: </span><span className="text-slate-300">{b.invalidation}</span></p>}
          {b.dataGaps?.length > 0 && <><Label>Data gaps</Label><ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-400">{b.dataGaps.map((g, i) => <li key={i}>{g}</li>)}</ul></>}
          <p className="mt-3 text-[11px] text-slate-500">{b.note || 'Not financial advice. Paper trading only.'} Generated {new Date(brief.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} by {brief.model}</p>
        </div>
      )}

      <Label>Ask about this market</Label>
      <form onSubmit={ask} className="mt-1 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          placeholder="e.g. Is funding stretched?"
          aria-label={`Ask about ${symbol}`}
          className="focus-ring min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <Btn type="submit" disabled={Boolean(pending) || q.trim().length < 3} aria-busy={Boolean(pending)}>
          {pending ? <><Spinner />Asking…</> : 'Ask'}
        </Btn>
      </form>
      {askErr && !off && <p className="mt-1 text-sm text-amber-400" role="alert">{askErr}</p>}
      <ul className="mt-2 space-y-2">
        {pending && (
          <li className="text-sm">
            <p className="text-slate-400">{pending}</p>
            <div role="status" className="mt-1 inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-slate-400">
              <Dots /><span>Thinking…</span>
            </div>
          </li>
        )}
        {qa.filter((x) => x.sym === symbol).map((x, i) => (
          <li key={i} className="text-sm">
            <p className="text-slate-400">{x.question}</p>
            <Answer text={x.answer} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-500">AI summary of market data. Not financial advice.</p>
    </Panel>
  );
};

export default CopilotPanel;
