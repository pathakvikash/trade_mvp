// src/components/ProtectedRoute.js
import React from 'react';
import { Navigate } from 'react-router-dom';
import useUserStore from '../store/userStore';

const ProtectedRoute = ({ children }) => {
  const { token, user } = useUserStore((state) => state);

  if (!token || !user) {
    return <Navigate to='/login' replace />;
  }

  return children;
};

export default ProtectedRoute;
