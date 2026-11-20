import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Toasts from './alerts/Toasts';
import usePersistedState from '../lib/usePersistedState';
import useUserStore from '../store/userStore';
import useAlertStore from '../store/alertStore';

const Layout = () => {
  const [collapsed, setCollapsed] = usePersistedState('sidebar.collapsed', false, { validate: (v) => typeof v === 'boolean' });
  const [mobileOpen, setMobileOpen] = useState(false);
  const token = useUserStore((s) => s.token);

  // One authenticated alerts socket while logged in; cleanup disconnects on logout.
  useEffect(() => (token ? useAlertStore.getState().connect(token) : undefined), [token]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-[#070b14] text-slate-200">
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/70 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setMobileOpen(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="mx-auto w-full max-w-[1920px] xl:h-full">
            <Outlet />
          </div>
        </main>
      </div>
      {token && <Toasts />}
    </div>
  );
};

export default Layout;
