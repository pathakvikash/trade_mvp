import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useMarketStore from '../store/marketStore';
import useUserStore from '../store/userStore';
import { fmtPct, fmtMarketPrice } from './ui/fmt';
import ConnectionChip from './ui/ConnectionChip';
import CommandPalette from './shell/CommandPalette';
import { Icon, ICONS } from './shell/nav';
import Avatar from './ui/Avatar';
import Logo from './ui/Logo';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

const Header = ({ onMenu }) => {
  const navigate = useNavigate();
  const marketData = useMarketStore((s) => s.marketData);
  const user = useUserStore((s) => s.user);
  const setLogout = useUserStore((s) => s.setLogout);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false);
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const logout = () => {
    setMenuOpen(false);
    setLogout();
    navigate('/login');
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-slate-800/80 bg-[#070b14] px-3">
      <button type="button" onClick={onMenu} className="focus-ring rounded-md p-1.5 text-slate-400 hover:text-slate-100 lg:hidden" aria-label="Open menu">
        <Icon d={ICONS.menu} className="h-[18px] w-[18px]" />
      </button>

      <Link to="/" aria-label="Paperline home" className="focus-ring shrink-0 rounded-md lg:hidden"><Logo size={22} decorative /></Link>

      <div role="group" className="hide-scrollbar flex min-w-0 flex-1 items-center gap-4 overflow-x-auto text-xs" aria-label="Live prices">
        {marketData.slice(0, 8).map((c) => {
          const up = (c.price_change_percentage_24h ?? 0) >= 0;
          return (
            <Link key={c.id} to={`/trade?symbol=${c.symbol.toUpperCase()}`} className="focus-ring flex shrink-0 items-baseline gap-1.5 rounded tabular-nums max-sm:min-h-9 max-sm:items-center">
              <span className="font-medium text-slate-300">{c.symbol.toUpperCase()}</span>
              <span className="text-slate-400">{fmtMarketPrice(c.current_price)}</span>
              <span className={up ? 'text-emerald-400' : 'text-rose-400'}>{fmtPct(c.price_change_percentage_24h)}</span>
            </Link>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="focus-ring flex h-7 items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2 text-xs text-slate-500 hover:border-slate-700 hover:text-slate-300 sm:w-52"
        aria-label="Search tokens and pages"
        aria-haspopup="dialog"
      >
        <Icon d={ICONS.search} className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="ml-auto hidden rounded border border-slate-700 px-1 text-[10px] sm:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <ConnectionChip />

      {user ? (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="focus-ring rounded-full"
            aria-label="User menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <Avatar avatar={user.profile?.avatar} name={user.name || user.username} size="sm" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-9 z-50 w-44 rounded-xl border border-slate-800 bg-slate-950 p-1 shadow-xl shadow-black/50">
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <Avatar avatar={user.profile?.avatar} name={user.name || user.username} size="xs" />
                <p className="truncate text-xs text-slate-400">{user.name || 'Signed in'}</p>
              </div>
              <button type="button" role="menuitem" onClick={logout} className="focus-ring flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-900">
                <Icon d={ICONS.logout} /> Logout
              </button>
            </div>
          )}
        </div>
      ) : (
        <Link to="/login" className="focus-ring rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-900">Sign in</Link>
      )}

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </header>
  );
};

export default Header;
