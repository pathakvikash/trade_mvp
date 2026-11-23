import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import React, { Suspense, useEffect } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import useMarketStore from './store/marketStore';

const Home = React.lazy(() => import('./pages/Home'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Trade = React.lazy(() => import('./pages/Trade'));
const Portfolio = React.lazy(() => import('./pages/Portfolio'));
const Derivatives = React.lazy(() => import('./pages/Derivatives'));
const Liquidation = React.lazy(() => import('./pages/Liquidation'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Login = React.lazy(() => import('./pages/Login'));
const Register = React.lazy(() => import('./pages/register'));
const Market = React.lazy(() => import('./pages/Market'));
const Stocks = React.lazy(() => import('./pages/Stocks'));
const NotFound = React.lazy(() => import('./pages/NotFound'));

function App() {
  // Start market socket on app load, stays connected throughout the app
  useEffect(() => {
    const cleanup = useMarketStore.getState().initSocket();
    return cleanup;
  }, []);

  const publicRoutes = [
    { path: '/', element: <Home />, index: true },
    { path: '/login', element: <Login /> },
    { path: '/register', element: <Register /> },
    { path: '/market', element: <Market /> },
    { path: '/stocks', element: <Stocks /> },
    { path: '/markets', element: <Navigate to="/market" replace /> },
  ];

  const protectedRoutes = [
    { path: '/dashboard', element: <Dashboard /> },
    { path: '/trade', element: <Trade /> },
    { path: '/derivatives', element: <Derivatives /> },
    { path: '/portfolio', element: <Portfolio /> },
    { path: '/liquidation', element: <Liquidation /> },
    { path: '/alerts', element: <Navigate to="/trade?alerts=1" replace /> },
    { path: '/settings/*', element: <Settings /> },
  ];
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading...</div>}>
        <Routes>
          {/* Public Routes */}
          <Route path='/' element={<Layout />}>
            {publicRoutes.map(({ path, element, index }) => (
              <Route
                key={path}
                path={index ? undefined : path.replace('/', '')}
                index={index}
                element={<ErrorBoundary>{element}</ErrorBoundary>}
              />
            ))}

            {/* Protected Routes (automatically wrapped) */}
            {protectedRoutes.map(({ path, element }) => (
              <Route
                key={path}
                path={path.replace('/', '')}
                element={
                  <ProtectedRoute>
                    <ErrorBoundary>{element}</ErrorBoundary>
                  </ProtectedRoute>
                }
              />
            ))}

            {/* Unknown paths: signed-out users go to login (as protected routes do), others see NotFound */}
            <Route
              path='*'
              element={
                <ProtectedRoute>
                  <ErrorBoundary><NotFound /></ErrorBoundary>
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
