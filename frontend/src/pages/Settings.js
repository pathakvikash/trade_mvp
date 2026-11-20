import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Panel from '../components/ui/Panel';
import SegTabs from '../components/ui/SegTabs';
import PairPicker from '../components/ui/PairPicker';
import useUserStore from '../store/userStore';
import { API, authed, errText } from '../lib/api';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'ai', label: 'AI & model' },
  { id: 'prefs', label: 'Preferences' },
  { id: 'security', label: 'Security' },
];
const TF_TABS = ['1m', '5m', '15m', '1h', '4h', '1d'].map((t) => ({ id: t, label: t }));
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const TIMEZONES = [...new Set([BROWSER_TZ, ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])])];

const field = 'focus-ring w-full rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 disabled:opacity-50';
const label = 'mb-1 block text-xs text-slate-400';
const primary = 'focus-ring rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-40';
const EMPTY_NOTICE = { tab: null, type: '', text: '' };

// Form state seeded from the saved values; re-seeded whenever they change (after load or a save).
const useDraft = (saved) => {
  const key = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(JSON.parse(key)), [key]);
  return [draft, setDraft, key];
};
const dirty = (draft, key) => JSON.stringify(draft) !== key;

const Settings = () => {
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user) || {};
  const setUser = useUserStore((s) => s.setUser);
  const setLogin = useUserStore((s) => s.setLogin);
  const setLogout = useUserStore((s) => s.setLogout);

  const [tab, setTab] = useState('profile');
  const [aiModels, setAiModels] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(EMPTY_NOTICE);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  const profileSaved = {
    name: user.name || '',
    bio: user.profile?.bio || '',
    country: user.profile?.country || '',
    timezone: user.profile?.timezone || BROWSER_TZ,
  };
  const p = user.preferences || {};
  const prefsSaved = {
    defaultSymbol: p.defaultSymbol || 'BTCUSDT',
    defaultTimeframe: p.defaultTimeframe || '1m',
    alertToasts: p.alertToasts !== false,
    alertSound: p.alertSound === true,
  };
  const aiSaved = { model: user.ai?.model ?? null };
  const [profile, setProfile, profileKey] = useDraft(profileSaved);
  const [prefs, setPrefs, prefsKey] = useDraft(prefsSaved);
  const [ai, setAi, aiKey] = useDraft(aiSaved);

  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    axios.get(`${API}/api/auth/me`, authed(token)).then((r) => {
      if (!live) return;
      setUser(r.data.user);
      setAiModels(Array.isArray(r.data.aiModels) ? r.data.aiModels : []);
    }, (e) => { if (live) setLoadErr(errText(e)); });
    return () => { live = false; };
  }, [token, setUser]);

  const patch = async (tabId, body) => {
    setSaving(true);
    setNotice(EMPTY_NOTICE);
    try {
      const r = await axios.patch(`${API}/api/auth/me`, body, authed(token));
      setUser(r.data.user);
      setNotice({ tab: tabId, type: 'success', text: 'Saved.' });
    } catch (e) {
      setNotice({ tab: tabId, type: 'error', text: errText(e) });
    }
    setSaving(false);
  };

  const changePassword = async (e) => {
    e.preventDefault();
    const fail = (text) => setNotice({ tab: 'security', type: 'error', text });
    if (pw.newPassword !== pw.confirmPassword) return fail('New passwords do not match.');
    if (pw.newPassword.length < 8 || pw.newPassword.length > 72) return fail('New password must be 8-72 characters.');
    setSaving(true);
    setNotice(EMPTY_NOTICE);
    try {
      const r = await axios.post(`${API}/api/auth/password`, { currentPassword: pw.currentPassword, newPassword: pw.newPassword }, authed(token));
      setLogin(r.data.token, user); // the server issues a fresh token; the old one stops working
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setNotice({ tab: 'security', type: 'success', text: 'Password changed.' });
    } catch (err) {
      fail(err.response?.data?.message || err.response?.data?.error || 'Could not change password.');
    }
    setSaving(false);
  };

  const pick = (id) => { setTab(id); setNotice(EMPTY_NOTICE); };
  const initials = (profile.name || user.username || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const aiOptions = [{ id: null, label: 'Server default', note: "The server's configured model." }, ...aiModels];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-sm font-semibold text-slate-200">Settings</h1>
        <SegTabs tabs={TABS} active={tab} onChange={pick} label="Settings sections" />
      </div>

      {loadErr && <p className="text-sm text-amber-400" role="alert">Could not load your settings: {loadErr}</p>}

      <Panel bodyClassName="p-4">
        {tab === 'profile' && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-cyan-500/40 bg-slate-900 text-lg font-semibold text-cyan-300">{initials}</div>
              <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt className="text-slate-500">Username</dt><dd className="text-slate-200">{user.username || '-'}</dd></div>
                <div><dt className="text-slate-500">Email</dt><dd className="break-all text-slate-200">{user.email || '-'}</dd></div>
                <div><dt className="text-slate-500">Role</dt><dd className="text-slate-200">{user.role || '-'}</dd></div>
                <div><dt className="text-slate-500">Member since</dt><dd className="text-slate-200">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}</dd></div>
              </dl>
            </div>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (dirty(profile, profileKey) && profile.name.trim()) patch('profile', { name: profile.name.trim(), profile: { bio: profile.bio, country: profile.country, timezone: profile.timezone } }); }}>
              <div className="sm:col-span-2">
                <label htmlFor="set-name" className={label}>Full name</label>
                <input id="set-name" className={field} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                {!profile.name.trim() && <p className="mt-0.5 text-[11px] text-amber-400">Name is required.</p>}
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="set-bio" className={label}>Bio</label>
                <textarea id="set-bio" rows={3} maxLength={160} className={field} value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} />
                <p className="mt-0.5 text-right text-[11px] tabular-nums text-slate-500">{profile.bio.length}/160</p>
              </div>
              <div>
                <label htmlFor="set-country" className={label}>Country</label>
                <input id="set-country" className={field} value={profile.country} onChange={(e) => setProfile({ ...profile, country: e.target.value })} />
              </div>
              <div>
                <label htmlFor="set-tz" className={label}>Timezone</label>
                <select id="set-tz" className={field} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}>
                  {[...new Set([profile.timezone, ...TIMEZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className={primary} disabled={saving || !dirty(profile, profileKey) || !profile.name.trim()}>Save</button>
              </div>
            </form>
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs text-slate-400">AI model</legend>
              {aiOptions.map((o) => {
                const on = ai.model === o.id;
                return (
                  <label key={o.id ?? 'default'} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${on ? 'border-cyan-500/60 bg-cyan-500/5' : 'border-slate-800 hover:border-slate-600'}`}>
                    <input type="radio" name="ai-model" value={o.id ?? 'default'} checked={on} onChange={() => setAi({ model: o.id })} className="mt-1 accent-cyan-400 focus-ring" />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-200">{o.label}</span>
                      {o.note && <span className="block text-xs text-slate-400">{o.note}</span>}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <p className="text-xs text-slate-400">AI runs only when you click an AI button, and it uses the model selected here. Cheaper models cost less per call.</p>
            <button type="button" className={primary} disabled={saving || !dirty(ai, aiKey)} onClick={() => patch('ai', { ai: { model: ai.model } })}>Save</button>
          </div>
        )}

        {tab === 'prefs' && (
          <div className="space-y-4">
            <div>
              <span className={label}>Default pair</span>
              <PairPicker value={prefs.defaultSymbol} onChange={(s) => setPrefs({ ...prefs, defaultSymbol: s })} />
            </div>
            <div>
              <span className={label}>Default timeframe</span>
              <SegTabs tabs={TF_TABS} active={prefs.defaultTimeframe} onChange={(t) => setPrefs({ ...prefs, defaultTimeframe: t })} label="Default timeframe" />
            </div>
            <div className="space-y-2 text-sm text-slate-300">
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" checked={prefs.alertToasts} onChange={(e) => setPrefs({ ...prefs, alertToasts: e.target.checked })} className="accent-cyan-400 focus-ring" />
                Show alert toasts
              </label>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" checked={prefs.alertSound} onChange={(e) => setPrefs({ ...prefs, alertSound: e.target.checked })} className="accent-cyan-400 focus-ring" />
                Play a sound when an alert triggers
              </label>
            </div>
            <button type="button" className={primary} disabled={saving || !dirty(prefs, prefsKey)} onClick={() => patch('prefs', { preferences: prefs })}>Save</button>
          </div>
        )}

        {tab === 'security' && (
          <div className="space-y-4">
            <form className="grid max-w-md gap-3" onSubmit={changePassword}>
              <div>
                <label htmlFor="set-pw-current" className={label}>Current password</label>
                <input id="set-pw-current" type="password" autoComplete="current-password" className={field} value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
              </div>
              <div>
                <label htmlFor="set-pw-new" className={label}>New password (8-72 characters)</label>
                <input id="set-pw-new" type="password" autoComplete="new-password" className={field} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
              </div>
              <div>
                <label htmlFor="set-pw-confirm" className={label}>Confirm new password</label>
                <input id="set-pw-confirm" type="password" autoComplete="new-password" className={field} value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} />
              </div>
              <p className="text-xs text-slate-400">Sessions on other devices stop working after a password change.</p>
              <div>
                <button type="submit" className={primary} disabled={saving || !pw.currentPassword || !pw.newPassword || !pw.confirmPassword}>Change password</button>
              </div>
            </form>
            <div className="border-t border-slate-800 pt-4">
              <button
                type="button"
                className="focus-ring rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-900"
                onClick={() => { setLogout(); window.location.assign('/login'); }}
              >
                Sign out
              </button>
            </div>
          </div>
        )}

        {notice.tab === tab && notice.text && (
          <p role={notice.type === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${notice.type === 'error' ? 'text-amber-400' : 'text-emerald-400'}`}>{notice.text}</p>
        )}
      </Panel>
    </div>
  );
};

export default Settings;
