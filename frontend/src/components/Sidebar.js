import React from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, ICONS, NAV } from './shell/nav';
import useAlertStore from '../store/alertStore';

// Desktop: slim rail (collapsible). Below lg: off-canvas drawer opened from the top bar.
const Sidebar = ({ collapsed, onToggle, mobileOpen, onClose }) => {
  const unread = useAlertStore((s) => s.unread);
  return (
  <aside
    className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden'} w-52 shrink-0 flex-col border-r border-slate-800/80 bg-[#070b14] lg:static lg:flex ${collapsed ? 'lg:w-14' : ''}`}
  >
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-800/80 px-3.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-cyan-400/15 text-[11px] font-bold text-cyan-300">TM</span>
      <span className={`text-sm font-semibold text-slate-100 ${collapsed ? 'lg:hidden' : ''}`}>TradeMVP</span>
      <button type="button" onClick={onClose} className="focus-ring ml-auto rounded-md p-1 text-slate-400 hover:text-slate-100 lg:hidden" aria-label="Close menu">
        <Icon d={ICONS.close} />
      </button>
    </div>

    <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Main">
      {NAV.map(({ path, label, d }) => (
        <NavLink
          key={path}
          to={path}
          onClick={onClose}
          title={label}
          aria-label={path === '/alerts' && unread > 0 ? `${label}, ${unread} unread` : label}
          className={({ isActive }) =>
            `focus-ring flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
              isActive ? 'bg-cyan-400/10 text-cyan-300' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`
          }
        >
          <Icon d={d} className="h-[18px] w-[18px]" />
          <span className={collapsed ? 'lg:hidden' : ''}>{label}</span>
          {path === '/alerts' && unread > 0 && (
            <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold tabular-nums text-slate-950" aria-hidden="true">{unread}</span>
          )}
        </NavLink>
      ))}
    </nav>

    <div className="hidden border-t border-slate-800/80 p-2 lg:block">
      <button
        type="button"
        onClick={onToggle}
        className="focus-ring flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] text-slate-500 hover:bg-slate-900 hover:text-slate-300"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
      >
        <Icon d={collapsed ? ICONS.chevronRight : ICONS.chevronLeft} className="h-[18px] w-[18px]" />
        <span className={collapsed ? 'hidden' : ''}>Collapse</span>
      </button>
    </div>
  </aside>
  );
};

export default Sidebar;
