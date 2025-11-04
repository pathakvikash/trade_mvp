// src/pages/Login.js
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import styles from '../styles/globalStyles';
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
    <div style={styles.authContainer}>
      <div style={styles.authCard}>
        <div style={styles.authHeader}>
          <h2 style={styles.authTitle}>Welcome Back</h2>
          <p style={styles.authSubtitle}>
            Login to access your crypto portfolio
          </p>
        </div>

        <form onSubmit={handleSubmit} style={styles.authForm}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              type='email'
              name='email'
              value={formData.email}
              onChange={handleChange}
              style={styles.input}
              placeholder='your@email.com'
              required
              disabled={loading}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <input
              type='password'
              name='password'
              value={formData.password}
              onChange={handleChange}
              style={styles.input}
              placeholder='••••••••'
              required
              disabled={loading}
            />
          </div>

          {error && <div style={styles.errorMessage}>{error}</div>}

          <button
            type='submit'
            style={{
              ...styles.authButton,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
            disabled={loading}
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>

          <div style={styles.authLinks}>
            <Link to='/forgot-password' style={styles.authLink}>
              Forgot Password?
            </Link>
            <div style={styles.authDivider}>
              <span style={styles.authDividerText}>Don't have an account?</span>
            </div>
            <Link to='/register' style={styles.authLinkSecondary}>
              Create Account
            </Link>
          </div>

          <div style={styles.guestInfo}>
            <p style={styles.guestText}>
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