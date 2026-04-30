import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import useUserStore from '../store/userStore';

const menuItems = [
  { path: '/dashboard', icon: '📊', label: 'Dashboard' },
  { path: '/market', icon: '📈', label: 'Market' },
  { path: '/trade', icon: '💱', label: 'Trade' },
  { path: '/portfolio', icon: '📁', label: 'Portfolio' },
  { path: '/liquidation', icon: '🔥', label: 'Liquidation' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
];

const Sidebar = ({ isCollapsed, toggleSidebar }) => {
  const navigate = useNavigate();
  const { user, setLogout } = useUserStore((state) => state);

  const handleLogout = () => {
    setLogout();
    navigate('/login');
  };

  return (
    <aside className={`hidden h-full shrink-0 flex-col min-h-0 border-r border-slate-800 bg-slate-950 px-3 py-5 text-slate-200 lg:flex ${isCollapsed ? 'w-20' : 'w-72'}`}>
      <div className="mb-6 flex items-center justify-between gap-3 px-1">
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          <div className="rounded-3xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">TM</div>
          {!isCollapsed && <h1 className="text-lg font-semibold text-white">TradeMVP</h1>}
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-full border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:bg-slate-800"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? '→' : '←'}
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-1">
        <div className="flex flex-col gap-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-3xl px-3 py-3 text-sm font-medium transition ${isActive ? 'bg-brand-600/15 text-brand-200' : 'text-slate-400 hover:bg-slate-900/80 hover:text-slate-100'
              } ${isCollapsed ? 'justify-center' : ''}`
            }
            title={item.label}
          >
            <span>{item.icon}</span>
            {!isCollapsed && item.label}
          </NavLink>
        ))}
        </div>
      </nav>

      <div className="mt-auto pt-4">
        <div
          className={`rounded-3xl border border-slate-800 bg-slate-900/80 text-slate-300 ${
            isCollapsed ? 'flex justify-center p-3' : 'p-4'
          }`}
        >
        {!isCollapsed ? (
          <>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Signed in as</p>
            <p className="mt-3 text-sm font-semibold text-white">{user?.name || 'Guest User'}</p>
            <button
              type="button"
              onClick={handleLogout}
              className="mt-4 w-full rounded-2xl bg-slate-800 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
            >
              Logout
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-full bg-slate-800 p-3 text-slate-200 transition hover:bg-slate-700"
            aria-label="Logout"
          >
            🚪
          </button>
        )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
