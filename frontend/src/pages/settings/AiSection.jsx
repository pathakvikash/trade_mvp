import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import SegTabs from '../../components/ui/SegTabs';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import { CONTEXT_TOO_SMALL, REASONING_BUDGET } from '../../components/ai/CopilotPanel';
import ModelCombobox from './ModelCombobox';
import { Field, SaveBar, SectionCard, Spin, btnGhost, btnPrimary, inputCls, isDirty, serverMsg, useDraft } from './shared';

// Used only when the server (older build) does not send aiProviders.
const FALLBACK_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', modelSuggestions: [], needsBaseUrl: false },
  { id: 'openai', label: 'OpenAI', modelSuggestions: [], needsBaseUrl: false },
  { id: 'gemini', label: 'Google Gemini', modelSuggestions: [], needsBaseUrl: false },
  { id: 'openrouter', label: 'OpenRouter', modelSuggestions: [], needsBaseUrl: false },
  { id: 'custom', label: 'Custom OpenAI-compatible', modelSuggestions: [], needsBaseUrl: true },
  { id: 'lmstudio', label: 'LM Studio (local)', modelSuggestions: [], needsBaseUrl: true, needsKey: false, defaultBaseUrl: 'http://localhost:1234/v1' },
];

const PRESETS = [
  { label: 'Concise risk-first', text: 'Be concise. Lead with the main risk and what would invalidate the idea, then the setup. Prefer numbers to adjectives. Never promise outcomes.' },
  { label: 'Beginner friendly', text: 'Explain in plain language for a beginner. Define any jargon in a few words, use short sentences, and always say how much could be lost.' },
  { label: 'Scalper (short-term)', text: 'Focus on the next minutes to hours: intraday levels, momentum, liquidity and funding. Give tight invalidation levels and keep risk per trade small.' },
  { label: 'Swing trader', text: 'Focus on multi-day to multi-week structure: trend, key daily and weekly levels, and catalysts. Prefer wider invalidation and smaller size over precise entries.' },
];

const LENGTHS = [
  { id: 'short', label: 'Short · 100 words' },
  { id: 'normal', label: 'Normal · 180 words' },
  { id: 'detailed', label: 'Detailed · 300 words' },
];

export const TEST_ERRORS = {
  ai_no_key: 'No API key is saved for this provider yet.',
  ai_auth_failed: 'The provider rejected the key. Check it and save it again.',
  ai_bad_base_url: 'The base URL is not usable. It must be https (http only on a local development server), and private or local network addresses are blocked.',
  ai_rate_limited: 'The provider (or this app) is rate limiting you. Wait a minute and retry.',
  ai_unreachable: 'Could not reach the provider. Check the base URL and your network.',
  ai_upstream_error: 'The provider returned an error. Try again shortly.',
  ai_not_configured: 'AI is not configured on the server for this option.',
  ai_key_unreadable: 'The saved key could not be read. Remove it and save it again.',
  ai_reasoning_budget: REASONING_BUDGET,
  ai_context_too_small: CONTEXT_TOO_SMALL,
  ai_bad_response: 'The provider answered in a format we do not recognise, so no model list could be read.',
  ai_list_too_large: 'This provider’s model list is too large to load. Type the model id instead.',
  rate_limited: 'Too many requests. Wait a minute and retry.',
  ai_local_disabled: 'Local models are turned off on this server (production). The server admin can set ALLOW_LOCAL_LLM=true.',
};

const KEY_RE = /^\S{8,300}$/;

// Last loaded model list per provider, kept in memory for this browser session only. Holds model names, never a key.
const modelCache = {};
export const clearModelCache = () => { Object.keys(modelCache).forEach((k) => delete modelCache[k]); };

const AiSection = ({ user, meta, notify }) => {
  const token = useUserStore((s) => s.token);
  const setUser = useUserStore((s) => s.setUser);
  const ai = user.ai || {};
  const providers = meta.aiProviders?.length ? meta.aiProviders : FALLBACK_PROVIDERS;
  const aiModels = Array.isArray(meta.aiModels) ? meta.aiModels : [];
  const saved = {
    provider: ai.provider || 'default',
    model: ai.model ?? null,
    providers: Object.fromEntries(providers.map((p) => [p.id, { model: ai.providers?.[p.id]?.model || '', baseUrl: ai.providers?.[p.id]?.baseUrl || '' }])),
    systemPrompt: ai.systemPrompt || '',
    temperature: typeof ai.temperature === 'number' ? ai.temperature : null,
    length: ai.length || 'normal',
  };
  const [draft, setDraft, key] = useDraft(saved);
  const dirty = isDirty(draft, key);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);
  const [localModels, setLocalModels] = useState(null); // null = not fetched; { ok, models | text }
  const [fetching, setFetching] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsErr, setModelsErr] = useState(null);
  const [lists, setLists] = useState({ ...modelCache });
  const loadSeq = useRef(0);

  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    axios.get(`${API}/api/ai/status`, authed(token)).then((r) => live && setStatus(r.data), () => {});
    return () => { live = false; };
  }, [token]);

  const pid = draft.provider;
  const byo = pid !== 'default';
  const info = providers.find((p) => p.id === pid);
  const pState = ai.providers?.[pid] || {};
  const setProviderField = (field, value) => setDraft({ ...draft, providers: { ...draft.providers, [pid]: { ...draft.providers[pid], [field]: value } } });
  const choose = (id) => { setDraft({ ...draft, provider: id }); setApiKey(''); setReplacing(false); setTest(null); setLocalModels(null); setModelsErr(null); loadSeq.current += 1; setLoadingModels(false); };
  const keyless = info?.needsKey === false;
  const local = pid === 'lmstudio';
  // The models route reads the SAVED base URL, so an unsaved edit to it would list the wrong server.
  const baseUrlDirty = (draft.providers[pid]?.baseUrl || '') !== (saved.providers[pid]?.baseUrl || '');

  const save = async () => {
    const changed = {};
    providers.forEach((p) => {
      const a = draft.providers[p.id];
      const b = saved.providers[p.id];
      if (a.model === b.model && a.baseUrl === b.baseUrl) return;
      changed[p.id] = { model: a.model, ...(p.needsBaseUrl ? { baseUrl: a.baseUrl } : {}) };
    });
    const body = { provider: draft.provider, model: draft.model, systemPrompt: draft.systemPrompt, temperature: draft.temperature, length: draft.length, ...(Object.keys(changed).length ? { providers: changed } : {}) };
    setSaving(true);
    try {
      const r = await axios.patch(`${API}/api/auth/me`, { ai: body }, authed(token));
      setUser(r.data.user);
      notify.success('AI settings saved.');
    } catch (e) {
      notify.error(serverMsg(e));
    }
    setSaving(false);
  };

  const patchKeyState = (patch) => setUser({ ...user, ai: { ...ai, providers: { ...ai.providers, [pid]: { ...pState, ...patch } } } });

  const saveKey = async (e) => {
    e.preventDefault();
    const value = apiKey;
    if (!KEY_RE.test(value)) return notify.error('An API key is 8-300 characters with no spaces.');
    setApiKey(''); // gone from the page immediately; only the last 4 characters ever come back
    setKeyBusy(true);
    try {
      const r = await axios.put(`${API}/api/ai/keys/${pid}`, { apiKey: value }, authed(token));
      patchKeyState({ keySet: true, keyLast4: r.data.keyLast4 });
      setReplacing(false);
      notify.success('API key saved.');
    } catch (err) {
      notify.error(serverMsg(err));
    }
    setKeyBusy(false);
  };

  const removeKey = async () => {
    setKeyBusy(true);
    try {
      await axios.delete(`${API}/api/ai/keys/${pid}`, authed(token));
      patchKeyState({ keySet: false, keyLast4: null });
      setTest(null);
      notify.success('API key removed.');
    } catch (err) {
      notify.error(serverMsg(err));
    }
    setKeyBusy(false);
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await axios.post(`${API}/api/ai/test`, { provider: pid }, authed(token));
      setTest({ ok: true, text: `Connected${r.data.model ? ` to ${r.data.model}` : ''} in ${r.data.latencyMs} ms.` });
      if (Array.isArray(r.data.models) && r.data.models.length) { modelCache[pid] = r.data.models; setLists({ ...modelCache }); setModelsErr(null); }
    } catch (e) {
      const code = e.response?.data?.error;
      setTest({ ok: false, text: TEST_ERRORS[code] || (e.response ? serverMsg(e) : 'Could not run the test.') });
    }
    setTesting(false);
  };

  // The typed key (if any) is sent for this one request and never kept anywhere else; without it the server uses the saved key.
  const loadModels = async () => {
    const typed = showKeyInput && KEY_RE.test(apiKey) ? apiKey : '';
    const seq = ++loadSeq.current;
    setLoadingModels(true);
    setModelsErr(null);
    try {
      const r = await axios.post(`${API}/api/ai/models`, { provider: pid, ...(typed ? { apiKey: typed, ...(info?.needsBaseUrl ? { baseUrl: draft.providers[pid]?.baseUrl || '' } : {}) } : {}) }, authed(token));
      if (seq !== loadSeq.current) return;
      const models = Array.isArray(r.data?.models) ? r.data.models : [];
      if (!models.length) setModelsErr('The provider returned no models for this key.');
      else { modelCache[pid] = models; setLists({ ...modelCache }); }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const code = e.response?.data?.error;
      setModelsErr(TEST_ERRORS[code] || (e.response ? serverMsg(e) : 'Could not reach the server.'));
    }
    if (seq === loadSeq.current) setLoadingModels(false);
  };

  const fetchModels = async () => {
    setFetching(true);
    try {
      const r = await axios.get(`${API}/api/ai/lmstudio/models`, authed(token));
      const models = Array.isArray(r.data?.models) ? r.data.models : [];
      setLocalModels(models.length ? { ok: true, models } : { ok: false, text: 'LM Studio answered but has no chat model loaded.' });
    } catch (e) {
      const code = e.response?.data?.error;
      setLocalModels({ ok: false, text: TEST_ERRORS[code] || (e.response ? serverMsg(e) : 'Could not reach the server.') });
    }
    setFetching(false);
  };

  const options = [{ id: 'default', label: 'App default', note: 'Uses the app’s own Anthropic key on the server. In local development it may use the Claude CLI on the developer’s machine instead.' },
    ...providers.map((p) => ({ id: p.id, label: p.label, note: p.docsNote || (p.id === 'custom' ? 'Any server that speaks the OpenAI chat API.' : 'Bring your own key.') }))];
  const modelOptions = [{ id: null, label: 'Server default', note: "The server's configured model." }, ...aiModels];
  const showKeyInput = byo && !keyless && (!pState.keySet || replacing);
  const keyId = 'ai-key';
  const pList = lists[pid];
  const typedKeyOk = showKeyInput && KEY_RE.test(apiKey);
  const baseMissing = !!info?.needsBaseUrl && !(draft.providers[pid]?.baseUrl || '');
  // With no typed key the server reads the SAVED key and SAVED base URL, so an unsaved base URL edit would list the wrong server.
  const canLoad = !loadingModels && !baseMissing && (typedKeyOk || (pState.keySet && !(info?.needsBaseUrl && baseUrlDirty)));

  return (
    <div className="space-y-3">
      <SectionCard title="Provider" description="Pick who answers your AI requests. AI runs only when you click an AI button.">
        <div role="radiogroup" aria-label="AI provider" className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const on = pid === o.id;
            return (
              <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${on ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-slate-800 hover:border-slate-600'}`}>
                <input type="radio" name="ai-provider" value={o.id} checked={on} onChange={() => choose(o.id)} className="focus-ring mt-1 accent-cyan-400" />
                <span className="min-w-0">
                  <span className="block text-sm text-slate-200">{o.label}</span>
                  <span className="block text-xs text-slate-400">{o.note}</span>
                </span>
              </label>
            );
          })}
        </div>

        {!byo && (
          <div className="mt-4 space-y-2">
            {status?.provider && <p className="text-xs text-slate-400" aria-live="polite">Active on the server: <span className="text-slate-200">{String(status.provider)}</span>{status.configured === false && ' (not configured)'}</p>}
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs text-slate-400">Model</legend>
              {modelOptions.map((o) => {
                const on = draft.model === o.id;
                return (
                  <label key={o.id ?? 'default'} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 ${on ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-slate-800 hover:border-slate-600'}`}>
                    <input type="radio" name="ai-model" value={o.id ?? 'default'} checked={on} onChange={() => setDraft({ ...draft, model: o.id })} className="focus-ring mt-1 accent-cyan-400" />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-200">{o.label}</span>
                      {o.note && <span className="block text-xs text-slate-400">{o.note}</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </div>
        )}

        {byo && (
          <div className="mt-4 grid gap-3">
            <Field id="ai-model-text" label="Model" hint={local ? 'Empty = the server default. Fetch models lists what LM Studio has loaded.' : pList ? 'Pick from your provider’s list, or type a full id and choose “Use custom id”.' : 'Press Load models below to pick from your provider’s list, or type any model id.'}>
              {!local && pList ? (
                <ModelCombobox id="ai-model-text" value={draft.providers[pid]?.model || ''} models={pList} onChange={(m) => setProviderField('model', m)} />
              ) : (
                <>
                  <input id="ai-model-text" list={`ai-models-${pid}`} className={inputCls} placeholder={local ? info?.modelSuggestions?.[0] || '' : undefined} value={draft.providers[pid]?.model || ''} onChange={(e) => setProviderField('model', e.target.value)} maxLength={100} autoComplete="off" />
                  <datalist id={`ai-models-${pid}`}>{[...new Set([...(localModels?.models || []), ...(info?.modelSuggestions || [])])].map((m) => <option key={m} value={m} />)}</datalist>
                </>
              )}
            </Field>
            {local && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={btnGhost} disabled={fetching || baseUrlDirty} onClick={fetchModels}>{fetching && <Spin />}Fetch models</button>
                {baseUrlDirty && <span className="text-[11px] text-slate-500">Save the base URL first.</span>}
                {localModels?.ok && (
                  <span className="flex flex-wrap gap-1" data-testid="lm-models">
                    {localModels.models.map((m) => <button key={m} type="button" className={btnGhost} onClick={() => setProviderField('model', m)}>{m}</button>)}
                  </span>
                )}
                {localModels && !localModels.ok && <p role="alert" className="text-sm text-amber-300">{localModels.text}</p>}
              </div>
            )}
            {info?.needsBaseUrl && (
              <Field id="ai-base-url" label="Base URL" hint={local ? 'Your LM Studio server. Only localhost, 127.0.0.1 or [::1]. Empty = the server default.' : 'https required (http allowed only on a local development server); private and local network addresses are blocked.'}>
                <input id="ai-base-url" type="url" className={inputCls} placeholder={local ? info?.defaultBaseUrl || 'http://localhost:1234/v1' : 'https://api.example.com/v1'} value={draft.providers[pid]?.baseUrl || ''} onChange={(e) => setProviderField('baseUrl', e.target.value)} maxLength={300} autoComplete="off" />
              </Field>
            )}
            {keyless ? (
              <p className="text-sm text-emerald-300" data-testid="no-key-needed">No key needed</p>
            ) : (
            <div>
              <span className="mb-1 block text-xs text-slate-400">API key</span>
              {!pState.keySet && <p className="mb-1 text-sm text-amber-300" data-testid="key-not-set">Key: not set</p>}
              {pState.keySet && !replacing && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-emerald-300">Key saved <span className="tabular-nums">••••{pState.keyLast4}</span></span>
                  <button type="button" className={btnGhost} disabled={keyBusy} onClick={() => setReplacing(true)}>Replace</button>
                  <button type="button" className={btnGhost} disabled={keyBusy} onClick={removeKey}>Remove</button>
                </div>
              )}
              {showKeyInput && (
                <form onSubmit={saveKey} className="flex flex-wrap items-center gap-2">
                  <label htmlFor={keyId} className="sr-only">{`${info?.label || 'Provider'} API key`}</label>
                  <input id={keyId} type="password" autoComplete="off" spellCheck={false} className={`${inputCls} max-w-sm`} placeholder="Paste your API key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                  <button type="submit" className={btnPrimary} disabled={keyBusy || !apiKey}>{keyBusy && <Spin />}Save key</button>
                  {replacing && <button type="button" className={btnGhost} onClick={() => { setReplacing(false); setApiKey(''); }}>Cancel</button>}
                </form>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={`${btnGhost} min-h-[44px]`} disabled={!canLoad} onClick={loadModels}>{loadingModels && <Spin />}Load models</button>
                {baseMissing && <span className="text-[11px] text-slate-500">Enter a base URL first.</span>}
                {!baseMissing && !typedKeyOk && pState.keySet && info?.needsBaseUrl && baseUrlDirty && <span className="text-[11px] text-slate-500">Save the base URL first.</span>}
                {pList && !loadingModels && !modelsErr && <span className="text-[11px] text-slate-400" aria-live="polite">{pList.length} models loaded.</span>}
              </div>
              {modelsErr && <p role="alert" className="mt-1 text-sm text-amber-300">{modelsErr}</p>}
              <p className="mt-1 text-[11px] text-slate-500">{showKeyInput ? 'Your key is sent to our server only to ask the provider for its model list; it is stored encrypted only when you press Save key. ' : 'Load models uses your saved key (stored encrypted on the server). '}Only the last 4 characters are ever displayed.</p>
            </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={btnGhost} disabled={testing || dirty} onClick={runTest}>{testing && <Spin />}Test connection</button>
          <span className="text-[11px] text-slate-500">Makes one tiny real request with your saved settings{dirty ? ' (save your changes first)' : ''}.</span>
        </div>
        {test && <p role={test.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${test.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{test.text}</p>}
      </SectionCard>

      <SectionCard title="System prompt" description="Your style prompt. It shapes tone and focus; it cannot remove the server's safety rules.">
        <label htmlFor="ai-prompt" className="sr-only">System prompt</label>
        <textarea id="ai-prompt" rows={5} maxLength={2000} className={inputCls} placeholder={meta.aiDefaultPrompt || 'App default style'} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">Empty = the app&apos;s default style (shown as the placeholder).</span>
          <span className="text-[11px] tabular-nums text-slate-500">{draft.systemPrompt.length}/2000</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => <button key={p.label} type="button" className={btnGhost} onClick={() => setDraft({ ...draft, systemPrompt: p.text })}>{p.label}</button>)}
          <button type="button" className={btnGhost} onClick={() => setDraft({ ...draft, systemPrompt: '' })}>Reset to default</button>
        </div>
        <details className="mt-3 rounded-md border border-slate-800 bg-slate-950/60 p-2 text-xs text-slate-400">
          <summary className="focus-ring cursor-pointer rounded text-slate-300">Always applied by the server</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{meta.aiServerRules || 'The server adds fixed rules to every request (paper-trading context, no financial advice). They are not editable.'}</pre>
        </details>
      </SectionCard>

      <SectionCard title="Response style">
        <div className="mb-1 text-xs text-slate-400">Response length</div>
        <SegTabs tabs={LENGTHS} active={draft.length} onChange={(l) => setDraft({ ...draft, length: l })} label="Response length" />
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="ai-temp" className="text-xs text-slate-400">Temperature <span className="tabular-nums text-slate-200">{draft.temperature === null ? 'provider default' : draft.temperature.toFixed(1)}</span></label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" className="focus-ring accent-cyan-400" checked={draft.temperature === null} onChange={(e) => setDraft({ ...draft, temperature: e.target.checked ? null : 0.7 })} />
              Provider default
            </label>
          </div>
          <input id="ai-temp" type="range" min="0" max="1" step="0.1" disabled={draft.temperature === null} value={draft.temperature ?? 0.7} onChange={(e) => setDraft({ ...draft, temperature: Math.round(Number(e.target.value) * 10) / 10 })} className="focus-ring mt-2 w-full accent-cyan-400 disabled:opacity-40" />
          <p className="mt-1 text-[11px] text-slate-500">Applies to OpenAI, Gemini, OpenRouter, Custom and LM Studio only. Anthropic models here ignore it.</p>
        </div>
      </SectionCard>

      <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => setDraft(JSON.parse(key))} />
    </div>
  );
};

export default AiSection;
