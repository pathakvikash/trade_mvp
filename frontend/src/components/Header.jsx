import React, { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import useMarketStore from '../store/marketStore';
import useUserStore from '../store/userStore';

const menuItems = [
  { path: '/dashboard', icon: '📊', label: 'Dashboard' },
  { path: '/market', icon: '📈', label: 'Market' },
  { path: '/trade', icon: '💱', label: 'Trade' },
  { path: '/portfolio', icon: '📁', label: 'Portfolio' },
  { path: '/liquidation', icon: '🔥', label: 'Liquidation' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
];

const Header = () => {
  const marketData = useMarketStore((state) => state.marketData);
  const user = useUserStore((state) => state.user);
  const { setLogout } = useUserStore((state) => state);
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const topMarkets = useMemo(
    () => marketData.slice(0, 4),
    [marketData]
  );

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const handleLogout = () => {
    setLogout();
    navigate('/login');
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleMobileMenu}
            className="rounded-full border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:bg-slate-800 lg:hidden"
            aria-label="Toggle mobile menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="rounded-3xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-slate-950/30">
            TradeMVP
          </div>
          <div className="hidden items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400 sm:flex">
            <span className="font-semibold uppercase tracking-[0.24em]">Live</span>
            {topMarkets.map((coin) => (
              <div key={coin.id} className="flex items-center gap-2 rounded-2xl bg-slate-950 px-3 py-2 text-slate-300">
                <span className="text-sm font-semibold text-white">{coin.symbol.toUpperCase()}</span>
                <span className={coin.price_change_percentage_24h >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {coin.price_change_percentage_24h?.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/85 px-4 py-3 md:max-w-xl">
          <input
            type="search"
            placeholder="Search coin, symbol or market"
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button className="hidden rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800 md:inline-flex">
            Wallet
          </button>
          <button className="rounded-full bg-slate-900/85 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-slate-950/20 hover:bg-slate-800">
            {user?.name ? `Hi, ${user.name}` : 'Guest'}
          </button>
        </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div className="fixed inset-0 bg-black/75" onClick={toggleMobileMenu} />
          <div className="fixed left-0 top-0 flex h-screen w-72 flex-col border-r border-slate-800 bg-slate-950 shadow-2xl shadow-black/70">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h2 className="text-lg font-semibold text-white">Menu</h2>
              <button
                onClick={toggleMobileMenu}
                className="rounded-full border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:bg-slate-800"
                aria-label="Close mobile menu"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-4">
              <div className="flex flex-col gap-2">
                {menuItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={toggleMobileMenu}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-3xl px-4 py-3 text-sm font-medium transition ${
                        isActive ? 'bg-brand-600/20 text-brand-200' : 'text-slate-300 hover:bg-slate-900 hover:text-slate-100'
                      }`
                    }
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </nav>
            <div className="mx-4 mb-4 mt-auto rounded-3xl border border-slate-800 bg-slate-900 p-4 text-slate-300">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Signed in as</p>
              <p className="mt-2 text-sm font-semibold text-white">{user?.name || 'Guest User'}</p>
              <button
                onClick={handleLogout}
                className="mt-4 w-full rounded-2xl bg-slate-800 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Header;
