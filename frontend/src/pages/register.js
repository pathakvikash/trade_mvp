import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../store/userStore';

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
        `${process.env.REACT_APP_API_URL}/api/auth/register`,
        registrationData,
      );

      if (registerResponse.data && registerResponse.data.success) {
        try {
          const loginResponse = await axios.post(
            `${process.env.REACT_APP_API_URL}/api/auth/login`,
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
            };
            setLogin(loginResponse.data.token, userData);

            navigate('/dashboard');
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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <div className="w-full max-w-md rounded-[1.25rem] border border-slate-800 bg-slate-900/90 p-6 shadow-soft backdrop-blur-sm sm:p-8">
        <div className="mb-8 text-center">
          <h2 className="bg-gradient-to-r from-blue-400 to-brand-500 bg-clip-text text-4xl font-bold text-transparent">
            Create Account
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Join thousands of crypto traders worldwide
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Full Name</label>
            <input
              type='text'
              name='name'
              value={formData.name}
              onChange={handleChange}
              placeholder='John Doe'
              required
              disabled={loading}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Email</label>
            <input
              type='email'
              name='email'
              value={formData.email}
              onChange={handleEmailChange}
              placeholder='your@email.com'
              required
              disabled={loading}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Username</label>
            <input
              type='text'
              name='username'
              value={formData.username}
              onChange={handleChange}
              placeholder='johndoe123'
              required
              disabled={loading}
              pattern='[a-zA-Z0-9_]{3,30}'
              title='3-30 characters: letters, numbers and underscore'
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <small className="text-xs text-slate-500">
              3-30 characters: letters, numbers and underscore
            </small>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Password</label>
            <input
              type='password'
              name='password'
              value={formData.password}
              onChange={handleChange}
              placeholder='••••••••'
              required
              minLength='8'
              maxLength='72'
              disabled={loading}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <small className="text-xs text-slate-500">
              Password must be 8-72 characters long
            </small>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Confirm Password</label>
            <input
              type='password'
              name='confirmPassword'
              value={formData.confirmPassword}
              onChange={handleChange}
              placeholder='••••••••'
              required
              minLength='8'
              disabled={loading}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type='submit'
            disabled={loading}
            className={`w-full rounded-2xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-500 ${
              loading ? 'cursor-not-allowed opacity-70' : ''
            }`}
          >
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <div className="space-y-4 pt-1 text-center">
            <div className="relative py-1">
              <div className="h-px w-full bg-slate-800" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-3 text-xs text-slate-500">
                Already have an account?
              </span>
            </div>
            <Link to='/login' className="text-sm text-slate-300 transition hover:text-white">
              Login Here
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Register;
