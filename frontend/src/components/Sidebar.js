import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import styles from '../styles/globalStyles';
import useUserStore from '../store/userStore';

const Sidebar = ({ isCollapsed, toggleSidebar }) => {
  const navigate = useNavigate();
  const { user, setLogout } = useUserStore((state) => state);

  const handleLogout = () => {
    setLogout();
    navigate('/login');
  };

  const menuItems = [
    { path: '/dashboard', icon: '📊', label: 'Dashboard' },
    { path: '/market', icon: '📈', label: 'Market' },
    { path: '/trade', icon: '💱', label: 'Trade' },
    { path: '/portfolio', icon: '📈', label: 'Portfolio' },
    { path: '/settings', icon: '⚙️', label: 'Settings' },
  ];

  return (
    <div
      style={{
        ...styles.sidebar,
        width: isCollapsed ? '80px' : '280px',
      }}
    >
      <div style={styles.sidebarHeader}>
        <div
          style={{
            ...styles.sidebarTitleContainer,
            justifyContent: isCollapsed ? 'center' : 'space-between',
          }}
        >
          {!isCollapsed && <h2 style={styles.sidebarTitle}>CryptoZen</h2>}
          <button
            onClick={toggleSidebar}
            style={styles.collapseButton}
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? '→' : '←'}
          </button>
        </div>

        {!isCollapsed && (
          <div style={styles.userInfo}>
            <div style={styles.userAvatar}>
              {user?.name?.[0]?.toUpperCase() || '?'}
            </div>
            <div style={styles.userName}>{user?.name || 'Guest'}</div>
          </div>
        )}
      </div>

      <nav style={styles.sidebarNav}>
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => ({
              ...styles.sidebarLink,
              backgroundColor: isActive
                ? 'rgba(37, 99, 235, 0.1)'
                : 'transparent',
              color: isActive ? '#2563eb' : '#64748b',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
            })}
            title={item.label}
          >
            <span style={styles.sidebarIcon}>{item.icon}</span>
            {!isCollapsed && item.label}
          </NavLink>
        ))}
      </nav>

      <div style={styles.sidebarFooter}>
        <button
          onClick={handleLogout}
          style={{
            ...styles.logoutButton,
            justifyContent: isCollapsed ? 'center' : 'flex-start',
          }}
          title='Logout'
        >
          <span style={styles.sidebarIcon}>🚪</span>
          {!isCollapsed && 'Logout'}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
