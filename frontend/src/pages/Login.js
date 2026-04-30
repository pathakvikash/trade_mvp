// src/pages/Login.js
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import useUserStore from '../store/userStore';

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

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/auth/login`,
        {
          email: formData.email.toLowerCase(),
          password: formData.password
        }
      );

      if (response.data?.success && response.data?.token) {
        const userData = {
          id: response.data.user._id,
          email: response.data.user.email,
          name: response.data.user.name,
          username: response.data.user.username,
          role: response.data.user.role
        };
        setLogin(response.data.token, userData);
        
        axios.defaults.headers.common['Authorization'] = `Bearer ${response.data.token}`;
        
        try {
          await axios.get(`${process.env.REACT_APP_API_URL}/api/auth/verify`, {
            headers: { Authorization: `Bearer ${response.data.token}` }
          });
          navigate('/dashboard');
        } catch (verifyError) {
          throw new Error('Token verification failed');
        }
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(
        err.response?.data?.message || 
        err.message || 
        'Login failed. Please try again.'
      );
      setLogout();
      delete axios.defaults.headers.common['Authorization'];
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <div className="w-full max-w-md rounded-[1.25rem] border border-slate-800 bg-slate-900/90 p-6 shadow-soft backdrop-blur-sm sm:p-8">
        <div className="mb-8 text-center">
          <h2 className="bg-gradient-to-r from-blue-400 to-brand-500 bg-clip-text text-4xl font-bold text-transparent">
            Welcome Back
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Login to access your crypto portfolio
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Email</label>
            <input
              type='email'
              name='email'
              value={formData.email}
              onChange={handleChange}
              placeholder='your@email.com'
              required
              disabled={loading}
              className="w-full rounded-2xl border border-slate-800 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
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
            {loading ? 'Logging in...' : 'Login'}
          </button>

          <div className="space-y-4 pt-1 text-center">
            <Link to='/forgot-password' className="text-sm text-brand-300 transition hover:text-brand-200">
              Forgot Password?
            </Link>
            <div className="relative py-1">
              <div className="h-px w-full bg-slate-800" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 px-3 text-xs text-slate-500">
                Don't have an account?
              </span>
            </div>
            <Link to='/register' className="text-sm text-slate-300 transition hover:text-white">
              Create Account
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
            <p className="leading-relaxed">
              Try as a guest:
              <br />
              Email: guest@cryptozen.com
              <br />
              Password: Guest@123
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;