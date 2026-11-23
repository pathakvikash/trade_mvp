// src/pages/Login.js
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../store/userStore';
import { API } from '../lib/api';
import { landingPath } from '../lib/landing';
import Spinner from '../components/ui/Spinner';
import GoogleButton from '../components/auth/GoogleButton';
import AuthShell, { Field, PasswordInput, inputClass } from '../components/auth/AuthShell';

const Login = () => {
  const navigate = useNavigate();
  const setLogin = useUserStore((state) => state.setLogin);
  const setLogout = useUserStore((state) => state.setLogout);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devHint, setDevHint] = useState(null); // DEV ONLY: remove with /api/auth/dev-hint when hosted

  // DEV ONLY: remove with /api/auth/dev-hint when hosted. Only the local dev server answers with credentials.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return; // dead-code-eliminated from production builds
    axios
      .get(`${API}/api/auth/dev-hint`)
      .then((r) => { if (r.data?.email && r.data?.password) setDevHint(r.data); })
      .catch(() => {}); // not local, or seeding is off: no card
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const signIn = async (email, password) => {
    if (loading) return; // one request in flight at a time
    setLoading(true);
    setError('');

    try {
      const response = await axios.post(
        `${API}/api/auth/login`,
        {
          email: email.toLowerCase(),
          password
        }
      );

      if (response.data?.success && response.data?.token) {
        const userData = {
          id: response.data.user._id,
          email: response.data.user.email,
          name: response.data.user.name,
          username: response.data.user.username,
          role: response.data.user.role,
          preferences: response.data.user.preferences,
          profile: response.data.user.profile,
        };
        setLogin(response.data.token, userData);

        try {
          await axios.get(`${API}/api/auth/verify`, {
            headers: { Authorization: `Bearer ${response.data.token}` }
          });
          navigate(landingPath(response.data.user.preferences));
        } catch (verifyError) {
          throw new Error('Token verification failed');
        }
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err) {
      console.error('Login error:', err && err.message);
      setError(
        (err.response?.status === 429 ? 'Too many attempts. Try again in a minute.' : null) ||
        err.response?.data?.message ||
        err.message ||
        'Login failed. Please try again.'
      );
      setLogout();
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    signIn(formData.email, formData.password);
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your paper trading account" busy={loading}>
        {/* DEV ONLY: remove with /api/auth/dev-hint when hosted */}
        {process.env.NODE_ENV === 'development' && devHint && (
          <div className="mb-6 rounded-2xl border border-amber-500/60 bg-amber-950/40 p-4 text-sm text-amber-200">
            <p className="font-semibold text-amber-300">Dev test login (local only)</p>
            <p className="mt-2 break-all">Email: <span className="font-mono">{devHint.email}</span></p>
            <p className="break-all">Password: <span className="font-mono">{devHint.password}</span></p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => setFormData({ email: devHint.email, password: devHint.password })}
                className="flex-1 rounded-xl border border-amber-500/60 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-900/40 disabled:opacity-60"
              >
                Fill form
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => signIn(devHint.email, devHint.password)}
                className="flex-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-60"
              >
                Sign in as test user
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field id="login-email" label="Email">
            <input
              id="login-email"
              type="email"
              name="email"
              autoComplete="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="you@email.com"
              required
              disabled={loading}
              className={inputClass}
            />
          </Field>

          <Field id="login-password" label="Password">
            <PasswordInput
              id="login-password"
              name="password"
              autoComplete="current-password"
              value={formData.password}
              onChange={handleChange}
              placeholder="Your password"
              required
              disabled={loading}
            />
          </Field>

          {error && (
            <div role="alert" className="rounded-xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className={`focus-ring inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/40 transition hover:bg-brand-500 ${
              loading ? 'cursor-not-allowed opacity-70' : ''
            }`}
          >
            {loading && <Spinner size={14} />}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <div className="relative py-1">
            <div className="h-px w-full bg-slate-800" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-3 text-xs text-slate-500">
              or
            </span>
          </div>
          <GoogleButton />

          <div className="flex items-center justify-between pt-1 text-sm">
            <Link to="/forgot-password" className="focus-ring rounded text-brand-300 transition hover:text-brand-200">
              Forgot password?
            </Link>
            <span className="text-slate-400">
              New here?{' '}
              <Link to="/register" className="focus-ring rounded font-medium text-slate-100 transition hover:text-white">
                Create account
              </Link>
            </span>
          </div>
        </form>
    </AuthShell>
  );
};

export default Login;
