// src/components/ProtectedRoute.js
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import useUserStore from '../store/userStore';
import { verifySession } from '../lib/api';

// A stored token is not proof of a session: it is checked against GET /api/auth/verify once per page load.
const ProtectedRoute = ({ children }) => {
  const { token, user } = useUserStore((state) => state);
  const [valid, setValid] = useState(null); // null = checking

  useEffect(() => {
    let live = true;
    if (token) verifySession(token).then((ok) => live && setValid(ok));
    return () => { live = false; };
  }, [token]);

  if (!token || !user || valid === false) {
    return <Navigate to='/login' replace />;
  }
  if (valid === null) return <div className="p-4 text-sm text-slate-500">Checking session...</div>;

  return children;
};

export default ProtectedRoute;
