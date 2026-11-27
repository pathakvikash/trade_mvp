import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Toasts from './alerts/Toasts';
import AgentDock from './ai/AgentDock';
import TickerBar from './shell/TickerBar';
import OrreryStrip from './shell/OrreryStrip';
import useApplyPreferences from '../lib/useApplyPreferences';
import useMainAnchorScroll from '../lib/useMainAnchorScroll';
import usePersistedState from '../lib/usePersistedState';
import useUserStore from '../store/userStore';
import useAlertStore from '../store/alertStore';
import useAgentStore from '../store/agentStore';
import useStrategyStore from '../store/strategyStore';

const Layout = () => {
  const [collapsed, setCollapsed] = usePersistedState('sidebar.collapsed', false, { validate: (v) => typeof v === 'boolean' });
  const [mobileOpen, setMobileOpen] = useState(false);
  const token = useUserStore((s) => s.token);
  const mainRef = useRef(null);
  useMainAnchorScroll(mainRef, useLocation().pathname);
  useApplyPreferences(useUserStore((s) => s.user?.preferences));

  // One authenticated alerts socket while logged in; cleanup disconnects on logout.
  useEffect(() => (token ? useAlertStore.getState().connect(token) : undefined), [token]);

  // sign-out must not leave the previous user's AI conversation or strategy overlay for the next login
  useEffect(() => {
    if (!token) { useAgentStore.getState().signOut(); useStrategyStore.getState().clear(); }
  }, [token]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="relative flex h-screen h-dvh overflow-clip bg-[#070b14] text-slate-200">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <OrreryStrip />
        <Header onMenu={() => setMobileOpen(true)} />
        <TickerBar />
        <main ref={mainRef} className="relative min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mx-auto w-full max-w-[1920px] xl:h-full">
            <Outlet />
          </div>
        </main>
      </div>
      {token && <Toasts />}
      {token && <AgentDock />}
    </div>
  );
};

export default Layout;
