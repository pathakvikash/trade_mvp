import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import { SectionCard, Spin, Toggle, btnDanger, btnGhost, btnPrimary, inputCls, labelCls, serverMsg } from './shared';

// 0..4 from length and character classes; only a hint, the server enforces 8-72.
export const passwordScore = (pw) => {
  if (pw.length < 8) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return 1 + (pw.length >= 12 ? 1 : 0) + (classes >= 2 ? 1 : 0) + (classes >= 3 && pw.length >= 10 ? 1 : 0);
};
const STRENGTH = [['Too short', 'bg-rose-500'], ['Weak', 'bg-rose-500'], ['Fair', 'bg-amber-400'], ['Good', 'bg-amber-400'], ['Strong', 'bg-emerald-400']];

export const aiRecipient = (ai = {}) => {
  const p = ai.provider || 'default';
  if (p === 'anthropic') return 'Anthropic, using your own API key';
  if (p === 'openai') return 'OpenAI, using your own API key';
  if (p === 'gemini') return 'Google (Gemini), using your own API key';
  if (p === 'openrouter') return 'OpenRouter, using your own API key';
  if (p === 'custom') return `your custom endpoint (${ai.providers?.custom?.baseUrl || 'URL not set yet'}), using your own API key`;
  return 'Anthropic, using the app’s own API key (in local development it may use the Claude CLI on the developer’s machine instead)';
};

const SecuritySection = ({ user, notify }) => {
  const token = useUserStore((s) => s.token);
  const setUser = useUserStore((s) => s.setUser);
  const setLogin = useUserStore((s) => s.setLogin);
  const setLogout = useUserStore((s) => s.setLogout);
  const navigate = useNavigate();
  const passwordSet = user.security?.passwordSet !== false;
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const score = passwordScore(pw.next);
  const emailMatches = !!user.email && confirmEmail.trim().toLowerCase() === user.email.toLowerCase();

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return notify.error('New passwords do not match.');
    if (pw.next.length < 8 || pw.next.length > 72) return notify.error('New password must be 8-72 characters.');
    setBusy('pw');
    try {
      const body = passwordSet ? { currentPassword: pw.current, newPassword: pw.next } : { newPassword: pw.next };
      const r = await axios.post(`${API}/api/auth/password`, body, authed(token));
      setLogin(r.data.token, { ...user, security: { ...user.security, passwordSet: true } }); // fresh token keeps this session signed in
      setPw({ current: '', next: '', confirm: '' });
      notify.success(`Password ${passwordSet ? 'changed' : 'set'}. Other sessions are signed out.`);
    } catch (err) {
      notify.error(serverMsg(err));
    }
    setBusy('');
  };

  const logoutOthers = async () => {
    setBusy('others');
    try {
      const r = await axios.post(`${API}/api/auth/logout-all`, {}, authed(token));
      setLogin(r.data.token, user);
      notify.success('Other sessions signed out.');
    } catch (err) {
      notify.error(serverMsg(err));
    }
    setBusy('');
  };

  const togglePortfolio = async (v) => {
    setBusy('portfolio');
    try {
      const r = await axios.patch(`${API}/api/auth/me`, { ai: { includePortfolio: v } }, authed(token));
      setUser(r.data.user);
      notify.success(v ? 'Portfolio will be included in AI context.' : 'Portfolio is no longer sent to AI.');
    } catch (err) {
      notify.error(serverMsg(err));
    }
    setBusy('');
  };

  const exportData = async () => {
    setBusy('export');
    try {
      const r = await axios.get(`${API}/api/auth/me/export`, { ...authed(token), responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cryptozen-export.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify.success('Export downloaded.');
    } catch (err) {
      notify.error(err.response?.status === 429 ? 'Too many exports, try again in a minute.' : 'Could not export your data.');
    }
    setBusy('');
  };

  const deleteAccount = async () => {
    setBusy('delete');
    try {
      await axios.delete(`${API}/api/auth/me`, { ...authed(token), data: { confirmEmail } });
      setLogout();
      navigate('/');
      return;
    } catch (err) {
      notify.error(err.response?.status === 409 ? (err.response.data?.message || 'Close your open futures positions and cancel pending futures orders first.') : serverMsg(err));
    }
    setBusy('');
  };

  const includes = user.ai?.includePortfolio === true;

  return (
    <div className="space-y-3">
      <SectionCard title={passwordSet ? 'Change password' : 'Set a password'} description={passwordSet ? undefined : 'This account was created with Google, so it has no password yet. Set one to also sign in with your email.'}>
        <form className="grid max-w-md gap-3" onSubmit={changePassword}>
          {passwordSet && (
            <div>
              <label htmlFor="set-pw-current" className={labelCls}>Current password</label>
              <input id="set-pw-current" type="password" autoComplete="current-password" className={inputCls} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
          )}
          <div>
            <label htmlFor="set-pw-new" className={labelCls}>New password (8-72 characters)</label>
            <input id="set-pw-new" type="password" autoComplete="new-password" maxLength={72} className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            {pw.next && (
              <div className="mt-1.5" aria-live="polite">
                <div className="flex gap-1" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= score ? STRENGTH[score][1] : 'bg-slate-800'}`} />)}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Strength: {STRENGTH[score][0]}</p>
              </div>
            )}
          </div>
          <div>
            <label htmlFor="set-pw-confirm" className={labelCls}>Confirm new password</label>
            <input id="set-pw-confirm" type="password" autoComplete="new-password" maxLength={72} className={inputCls} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </div>
          <p className="text-xs text-slate-400">Sessions on other devices are signed out after this.</p>
          <div>
            <button type="submit" className={btnPrimary} disabled={busy === 'pw' || (passwordSet && !pw.current) || !pw.next || !pw.confirm}>{busy === 'pw' && <Spin />}{passwordSet ? 'Change password' : 'Set password'}</button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Sessions" description="Sign-in sessions last 24 hours. Signing out other sessions keeps this device signed in.">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnGhost} disabled={busy === 'others'} onClick={logoutOthers}>{busy === 'others' && <Spin />}Sign out other sessions</button>
          <button type="button" className={btnGhost} onClick={() => { setLogout(); window.location.assign('/login'); }}>Sign out of this device</button>
        </div>
      </SectionCard>

      <SectionCard title="AI data policy">
        <Toggle id="ai-portfolio" checked={includes} disabled={busy === 'portfolio'} onChange={togglePortfolio} label="Include my portfolio and positions in AI context" hint="Off by default. When off, only public market data is sent. When on, your paper cash, spot holdings and open futures positions are added." />
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-400">
          <li>Sent with each AI request: a market data snapshot, your question, your style prompt{includes ? ', and your portfolio and open positions' : ''}.</li>
          <li>Sent to: {aiRecipient(user.ai)}.</li>
          <li>API keys are encrypted at rest and never shown again.</li>
          <li>The app does not store your AI conversations, so there is no history to export or delete.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Export your data" description="Download your profile, paper balances, trades, orders, positions and alerts as JSON. API keys are not included.">
        <button type="button" className={btnGhost} disabled={busy === 'export'} onClick={exportData}>{busy === 'export' && <Spin />}Download export</button>
      </SectionCard>

      <SectionCard title="Danger zone" tone="danger" description="Deleting your account removes your paper-trading data. No real money is involved, but this cannot be undone. Close open futures positions and cancel pending futures orders first.">
        <div className="max-w-md">
          <label htmlFor="del-email" className={labelCls}>Type your email ({user.email || 'your email'}) to confirm</label>
          <input id="del-email" type="email" autoComplete="off" className={inputCls} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
          <button type="button" className={`${btnDanger} mt-3`} disabled={!emailMatches || busy === 'delete'} onClick={deleteAccount}>{busy === 'delete' && <Spin />}Delete my account</button>
        </div>
      </SectionCard>
    </div>
  );
};

export default SecuritySection;
