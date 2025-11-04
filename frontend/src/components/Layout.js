import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import styles from '../styles/globalStyles';

const Layout = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div style={styles.layoutContainer}>
      <Sidebar isCollapsed={isCollapsed} toggleSidebar={toggleSidebar} />
      <main style={{
        ...styles.mainContent,
        marginLeft: isCollapsed ? '80px' : '280px',
      }}>
        <Outlet />
      </main>
    </div>
  );
};

export default Layout; 