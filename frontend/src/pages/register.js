import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../store/userStore';
import { API } from '../lib/api';
import { landingPath } from '../lib/landing';
import Spinner from '../components/ui/Spinner';
import GoogleButton from '../components/auth/GoogleButton';
import AuthShell, { Field, PasswordInput, inputClass } from '../components/auth/AuthShell';

const Register = () => {
  const navigate = useNavigate();
  const setLogin = useUserStore((state) => state.setLogin);
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  // Generate a username suggestion from email
  const generateUsername = (email) => {
    return email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '');
  };

  // Handle email change to suggest a username
  const handleEmailChange = (e) => {
    const email = e.target.value;
    setFormData((prev) => ({
      ...prev,
      email,
      username:
        !prev.username || prev.username === generateUsername(prev.email)
          ? generateUsername(email)
          : prev.username,
    }));
    setError('');
  };

  // Same rule the server enforces (8-72 characters, no character classes); bcrypt ignores anything past 72 bytes.
  const validatePassword = (password) =>
    password.length < 8 || password.length > 72 ? 'Password must be 8-72 characters long' : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // one request in flight at a time

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passwordError = validatePassword(formData.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (!formData.username) {
      setError('Username is required');
      return;
    }

    setLoading(true);
    try {
      // role is never sent: the server always creates plain users
      const { name, username, email, password } = formData;
      const registrationData = { name, username, email, password };
      const registerResponse = await axios.post(
        `${API}/api/auth/register`,
        registrationData,
      );

      if (registerResponse.data && registerResponse.data.success) {
        try {
          const loginResponse = await axios.post(
            `${API}/api/auth/login`,
            {
              email: formData.email,
              password: formData.password,
            },
          );

          if (loginResponse.data && loginResponse.data.token) {
            const userData = {
              id: loginResponse.data.user._id,
              email: loginResponse.data.user.email,
              name: loginResponse.data.user.name,
              username: loginResponse.data.user.username,
              role: loginResponse.data.user.role,
              preferences: loginResponse.data.user.preferences,
              profile: loginResponse.data.user.profile,
            };
            setLogin(loginResponse.data.token, userData);

            navigate(landingPath(loginResponse.data.user.preferences));
          } else {
            throw new Error('Invalid login response');
          }
        } catch (loginError) {
          console.error('Auto-login error:', loginError && loginError.message);
          setError('Registration successful. Please login manually.');
          navigate('/login');
        }
      } else {
        setError('Registration failed. Please try again.');
      }
    } catch (err) {
      console.error('Registration error:', err && err.message);
      setError(
        (err.response?.status === 429 ? 'Too many sign-ups from this address. Try again later.' : null) ||
          err.response?.data?.message ||
          'Registration failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Create account" subtitle="Start paper trading with a virtual balance" busy={loading}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field id="reg-name" label="Full name">
            <input
              id="reg-name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="John Doe"
              required
              disabled={loading}
              autoComplete="name"
              className={inputClass}
            />
          </Field>
          <Field id="reg-email" label="Email">
            <input
              id="reg-email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleEmailChange}
              placeholder="you@email.com"
              required
              disabled={loading}
              autoComplete="email"
              className={inputClass}
            />
          </Field>
          <Field id="reg-username" label="Username" hint="3-30 characters: letters, numbers and underscore">
            <input
              id="reg-username"
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              placeholder="johndoe123"
              required
              disabled={loading}
              autoComplete="username"
              pattern="[a-zA-Z0-9_]{3,30}"
              title="3-30 characters: letters, numbers and underscore"
              className={inputClass}
            />
          </Field>
          <Field id="reg-password" label="Password" hint="Password must be 8-72 characters long">
            <PasswordInput
              id="reg-password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="At least 8 characters"
              required
              disabled={loading}
              autoComplete="new-password"
              minLength="8"
              maxLength="72"
            />
          </Field>
          <Field id="reg-confirm" label="Confirm password">
            <PasswordInput
              id="reg-confirm"
              name="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder="Repeat password"
              required
              disabled={loading}
              autoComplete="new-password"
              minLength="8"
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
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <div className="relative py-1">
            <div className="h-px w-full bg-slate-800" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-3 text-xs text-slate-500">
              or
            </span>
          </div>
          <GoogleButton />

          <p className="pt-1 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <Link to="/login" className="focus-ring rounded font-medium text-slate-100 transition hover:text-white">
              Login here
            </Link>
          </p>
        </form>
    </AuthShell>
  );
};

export default Register;
