import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Panel from '../components/ui/Panel';
import usePolling from '../lib/usePolling';
import { API, authed, errText } from '../lib/api';
import useUserStore from '../store/userStore';
import useAlertStore from '../store/alertStore';
import { FUT, fmtTime } from '../components/liquidation/shared';
import { NOT_CONFIGURED, aiError, useAiConfigured } from '../components/ai/CopilotPanel';
import { METRICS, describeAlert, emptyForm, validateAlert } from '../components/alerts/alertLogic';

const field = 'focus-ring w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50';
const btn = 'focus-ring rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-900 disabled:opacity-50';
const Field = ({ label, error, children }) => (
  <label className="block text-xs text-slate-400">
    {label}
    {children}
    {error && <span className="mt-0.5 block text-amber-400" role="alert">{error}</span>}
  </label>
);
// Server messages for create failures -> readable text.
const createError = (e) => {
  const m = e?.response?.data?.error;
  if (m === 'unknown symbol') return 'Unknown symbol: that is not a Binance USDT perpetual.';
  if (m === 'max 5 symbols') return 'Alerts can cover at most 5 different symbols. Delete one first.';
  if (m === 'max 20 alerts') return 'You already have 20 alerts. Delete one first.';
  return errText(e);
};
const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never');

const Alerts = () => {
  const token = useUserStore((s) => s.token);
  const { alerts, events, loaded, error } = useAlertStore();
  const { load, create, patch, remove, clearUnread } = useAlertStore.getState();
  const { data: overview } = usePolling(`${FUT}/overview`, 60000);
  const symbols = useMemo(() => (Array.isArray(overview) ? overview.map((r) => r.symbol).sort() : []), [overview]);
  const [configured, setConfigured] = useAiConfigured();

  const [form, setForm] = useState(emptyForm());
  const [errs, setErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseErr, setParseErr] = useState(null);
  const [edit, setEdit] = useState(null); // {id, value}

  useEffect(() => {
    clearUnread();
    load(token);
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const parse = async (ev) => {
    ev.preventDefault();
    if (text.trim().length < 3) return;
    setParsing(true);
    setParseErr(null);
    try {
      const r = await axios.post(`${API}/api/ai/alerts/parse`, { text: text.trim() }, authed(token));
      const d = r.data?.draft || {};
      setForm({ ...emptyForm(d.symbol), metric: d.metric, op: d.op, value: String(d.value ?? ''), note: d.note || '' });
      setErrs({});
      setMsg('Draft filled in below. Review it, then press Create.');
    } catch (e) {
      const r = aiError(e);
      if (r.unconfigured) setConfigured(false);
      setParseErr(e?.response?.data?.error === 'could_not_parse' ? `Could not parse that${e.response.data.reason ? `: ${e.response.data.reason}` : '.'}` : r.msg);
    }
    setParsing(false);
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const v = validateAlert(form, alerts.length, symbols, alerts.map((a) => a.symbol));
    setErrs(v);
    if (Object.keys(v).length) return;
    setSaving(true);
    setMsg(null);
    try {
      await create(token, {
        symbol: form.symbol, metric: form.metric, op: form.op, value: Number(form.value),
        note: form.note.trim(), cooldownMin: Number(form.cooldownMin),
      });
      setForm(emptyForm(form.symbol));
      setMsg('Alert created.');
    } catch (e) {
      setErrs({ form: createError(e) });
    }
    setSaving(false);
  };

  const act = async (fn) => {
    setMsg(null);
    try { await fn(); } catch (e) { setMsg(errText(e)); }
  };

  const off = configured === false;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Describe an alert" bodyClassName="p-3">
          {off && <p className="mb-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 text-sm text-amber-400" role="alert">{NOT_CONFIGURED}</p>}
          <form onSubmit={parse} className="flex gap-2">
            <input value={text} onChange={(e) => setText(e.target.value)} disabled={off} maxLength={300} aria-label="Describe an alert in plain English" placeholder="Tell me when ETH funding goes above 0.05%" className={field} />
            <button type="submit" className={btn} disabled={off || parsing || text.trim().length < 3}>{parsing ? 'Parsing...' : 'Parse'}</button>
          </form>
          {parseErr && <p className="mt-1 text-sm text-amber-400" role="alert">{parseErr}</p>}
          <p className="mt-2 text-[11px] text-slate-500">AI parses your text into the form. Nothing is created until you press Create.</p>
        </Panel>

        <Panel title="New alert" bodyClassName="p-3">
          <form onSubmit={submit} className="grid grid-cols-2 gap-2 sm:grid-cols-3" noValidate>
            <Field label="Symbol" error={errs.symbol}>
              <select value={form.symbol} onChange={set('symbol')} className={field}>
                {[...new Set([form.symbol, ...symbols])].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Metric" error={errs.metric}>
              <select value={form.metric} onChange={set('metric')} className={field}>
                {Object.entries(METRICS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
            <Field label="Condition" error={errs.op}>
              <select value={form.op} onChange={set('op')} className={field}><option value="above">Above</option><option value="below">Below</option></select>
            </Field>
            <Field label="Value" error={errs.value}>
              <input value={form.value} onChange={set('value')} inputMode="decimal" className={`${field} tabular-nums`} />
            </Field>
            <Field label="Cooldown (min)" error={errs.cooldownMin}>
              <input value={form.cooldownMin} onChange={set('cooldownMin')} inputMode="numeric" className={`${field} tabular-nums`} />
            </Field>
            <Field label="Note">
              <input value={form.note} onChange={set('note')} maxLength={200} className={field} />
            </Field>
            <div className="col-span-full flex items-center gap-3">
              <button type="submit" className={btn} disabled={saving}>{saving ? 'Creating...' : 'Create'}</button>
              <span className="text-xs text-slate-400">{validateAlert(form).value ? '' : describeAlert(form)}</span>
            </div>
            {errs.form && <p className="col-span-full text-sm text-amber-400" role="alert">{errs.form}</p>}
          </form>
        </Panel>
      </div>
      {msg && <p className="text-sm text-slate-400" role="status">{msg}</p>}

      <Panel title={`Alerts (${alerts.length}/20)`} bodyClassName="overflow-x-auto p-3">
        {!loaded ? <p className="py-4 text-center text-sm text-slate-400">Loading...</p>
          : error ? <p className="py-4 text-center text-sm text-amber-400">Could not load alerts: {error} <button type="button" className={btn} onClick={() => load(token)}>Retry</button></p>
          : alerts.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">No alerts yet.</p> : (
            <table className="w-full min-w-[560px] text-xs tabular-nums">
              <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr><th className="px-2 py-1 font-medium">Active</th><th className="px-2 py-1 font-medium">Alert</th><th className="px-2 py-1 font-medium">Note</th><th className="px-2 py-1 font-medium">Last triggered</th><th className="px-2 py-1" /></tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a._id} className="border-t border-slate-800/60">
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={!!a.active} onChange={(e) => act(() => patch(token, a._id, { active: e.target.checked }))} aria-label={`Active: ${describeAlert(a)}`} className="focus-ring accent-cyan-400" />
                    </td>
                    <td className="px-2 py-1 text-slate-200">
                      {edit?.id === a._id ? (
                        <form className="flex items-center gap-1" onSubmit={(ev) => {
                          ev.preventDefault();
                          const v = Number(edit.value);
                          if (edit.value === '' || !Number.isFinite(v) || (a.metric !== 'funding' && v <= 0)) return setMsg('Enter a valid value.');
                          act(() => patch(token, a._id, { value: v })).then(() => setEdit(null));
                        }}>
                          <span>{a.symbol} {a.metric} {a.op}</span>
                          <input autoFocus value={edit.value} onChange={(e) => setEdit({ id: a._id, value: e.target.value })} aria-label="New value" className={`${field} w-24`} />
                          <button type="submit" className={btn}>Save</button>
                          <button type="button" className={btn} onClick={() => setEdit(null)}>Cancel</button>
                        </form>
                      ) : describeAlert(a)}
                      {a.status === 'watching' && <span className="ml-2 rounded border border-emerald-400/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-400">Watching</span>}
                      {a.status === 'no_data' && <span title="No live price for this symbol yet" className="ml-2 cursor-help rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-400">No data</span>}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-1 text-slate-400">{a.note}</td>
                    <td className="px-2 py-1 text-slate-400">{when(a.lastTriggeredAt)}</td>
                    <td className="space-x-1 whitespace-nowrap px-2 py-1 text-right">
                      <button type="button" className={btn} onClick={() => setEdit({ id: a._id, value: String(a.value) })}>Edit value</button>
                      <button type="button" className={`${btn} text-rose-400`} onClick={() => window.confirm(`Delete alert "${describeAlert(a)}"?`) && act(() => remove(token, a._id))}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Panel>

      <Panel title="Recent triggers" bodyClassName="max-h-72 overflow-auto p-3">
        {events.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">No triggers yet.</p> : (
          <ul className="divide-y divide-slate-800/60 text-xs tabular-nums">
            {events.map((e) => (
              <li key={e._id} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span className="text-slate-200">{describeAlert(e)}</span>
                <span className="text-slate-400">observed {Number(e.observed).toLocaleString('en-US', { maximumFractionDigits: 6 })} · {fmtTime(e.ts)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
};

export default Alerts;
