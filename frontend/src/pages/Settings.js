import React, { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import axios from 'axios';
import { Icon } from '../components/shell/nav';
import useUserStore from '../store/userStore';
import usePersistedState, { oneOf } from '../lib/usePersistedState';
import { API, authed, errText } from '../lib/api';
import AiSection from './settings/AiSection';
import PreferencesSection from './settings/PreferencesSection';
import ProfileSection from './settings/ProfileSection';
import SecuritySection from './settings/SecuritySection';
import { Toast, useToast } from './settings/shared';

export const SECTIONS = [
  { id: 'profile', label: 'Profile', d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', Component: ProfileSection },
  { id: 'ai', label: 'AI & model', d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z', Component: AiSection },
  { id: 'preferences', label: 'Preferences', d: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4', Component: PreferencesSection },
  { id: 'security', label: 'Security', d: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', Component: SecuritySection },
];
const IDS = SECTIONS.map((s) => s.id);

// Shell for /settings/*: section nav on the left (a pill row below lg), one section on the right.
const Settings = () => {
  const token = useUserStore((s) => s.token);
  const user = useUserStore((s) => s.user) || {};
  const setUser = useUserStore((s) => s.setUser);
  const splat = useParams()['*'] || '';
  const section = splat.split('/')[0];
  const [last, setLast] = usePersistedState('settings.section', 'profile', { validate: oneOf(...IDS) });
  const { toast, notify, clear } = useToast();
  const [meta, setMeta] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    if (IDS.includes(section) && last !== section) setLast(section);
  }, [section, last, setLast]);

  // Below lg the nav is a horizontally scrolling pill row: bring the active pill into view (on a phone 'Security' starts
  // off-screen). block 'nearest' keeps the page itself from jumping; motion follows the OS and the in-app setting.
  const navRef = useRef(null);
  useEffect(() => {
    const el = navRef.current?.querySelector('[aria-current="page"]');
    if (!el?.scrollIntoView) return;
    const reduce = document.documentElement.dataset.reduceMotion === 'true' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [section]);

  // Loaded once for all sections; the user store is the live copy, the rest is reference data.
  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    axios.get(`${API}/api/auth/me`, authed(token)).then((r) => {
      if (!live) return;
      setUser(r.data.user);
      setMeta({ aiModels: r.data.aiModels, aiProviders: r.data.aiProviders, aiDefaultPrompt: r.data.aiDefaultPrompt, aiServerRules: r.data.aiServerRules });
      setLoaded(true);
    }, (e) => { if (live) { setLoadErr(errText(e)); setLoaded(true); } });
    return () => { live = false; };
  }, [token, setUser]);

  if (!splat) return <Navigate to={`/settings/${last}`} replace />;
  if (!IDS.includes(section)) return <Navigate to="/settings/profile" replace />;
  const { Component } = SECTIONS.find((s) => s.id === section);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
      <nav ref={navRef} aria-label="Settings sections" className="hide-scrollbar flex gap-1.5 overflow-x-auto lg:sticky lg:top-0 lg:w-48 lg:shrink-0 lg:flex-col lg:gap-0.5 lg:overflow-visible">
        {SECTIONS.map(({ id, label, d }) => (
          <NavLink
            key={id}
            to={`/settings/${id}`}
            className={({ isActive }) =>
              `focus-ring flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors lg:rounded-lg lg:border-transparent lg:px-2.5 ${
                isActive ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-300' : 'border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`
            }
          >
            <Icon d={d} className="h-[16px] w-[16px]" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        <h1 className="mb-2 text-sm font-semibold text-slate-200">Settings</h1>
        {loadErr && <p className="mb-2 text-sm text-amber-400" role="alert">Could not load your settings: {loadErr}</p>}
        {!loaded && <p className="mb-2 text-xs text-slate-500" aria-live="polite">Loading your settings…</p>}
        <p className="mb-3 text-xs text-slate-500">CryptoZen is paper trading: no real money is ever used.</p>
        <Component user={user} meta={meta} notify={notify} />
      </div>
      <Toast toast={toast} onClose={clear} />
    </div>
  );
};

export default Settings;
