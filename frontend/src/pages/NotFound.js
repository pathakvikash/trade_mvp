import React from 'react';
import { Link } from 'react-router-dom';

const NotFound = () => (
  <div className="flex min-h-full flex-col items-center justify-center bg-slate-950 px-4 py-16 text-center text-slate-100">
    <p className="text-5xl font-bold text-slate-600">404</p>
    <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
    <p className="mt-2 max-w-sm text-sm text-slate-400">The page you are looking for does not exist or has moved.</p>
    <div className="mt-6 flex gap-3">
      <Link to="/dashboard" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500">Dashboard</Link>
      <Link to="/trade" className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-900">Trade</Link>
    </div>
  </div>
);

export default NotFound;
