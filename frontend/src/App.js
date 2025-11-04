import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import React, { Suspense } from 'react';
import ErrorBoundary from './components/ErrorBoundary';

const Home = React.lazy(() => import('./pages/Home'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Trade = React.lazy(() => import('./pages/Trade'));
const Portfolio = React.lazy(() => import('./pages/Portfolio'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Login = React.lazy(() => import('./pages/Login'));
const Register = React.lazy(() => import('./pages/register'));
const Market = React.lazy(() => import('./pages/Market'));
const CandlestickChart = React.lazy(() => import('./CandlestickChart'));

function App() {
  const publicRoutes = [
    { path: '/', element: <Home />, index: true },
    { path: '/login', element: <Login /> },
    { path: '/register', element: <Register /> },
    { path: '/market', element: <Market /> },
  ];

  const protectedRoutes = [
    { path: '/dashboard', element: <Dashboard /> },
    { path: '/trade', element: <Trade /> },
    { path: '/portfolio', element: <Portfolio /> },
    { path: '/settings', element: <Settings /> },
    { path: '/candlestick-chart', element: <CandlestickChart /> },
  ];
  return (
    <BrowserRouter>
      <Suspense fallback={<div>Loading...</div>}>
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
                element={<ProtectedRoute><ErrorBoundary>{element}</ErrorBoundary></ProtectedRoute>}
              />
            ))}
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
