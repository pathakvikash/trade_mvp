import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import styles from '../styles/globalStyles';
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
    role: 'user', // Default role
  });
  const [autofilled, setAutofilled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  // Check if email already exists
  const checkEmailExists = async (email) => {
    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/auth/check-email`,
        { email }
      );
      return response.data.exists;
    } catch (err) {
      console.error('Error checking email:', err);
      return false;
    }
  };

  // Generate a username suggestion from email
  const generateUsername = (email) => {
    return email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };

  // Handle email change to suggest username and check uniqueness
  const handleEmailChange = async (e) => {
    const email = e.target.value;
    setFormData((prev) => ({
      ...prev,
      email,
      username:
        !prev.username || prev.username === generateUsername(prev.email)
          ? generateUsername(email)
          : prev.username,
    }));

    if (email) {
      const exists = await checkEmailExists(email);
      if (exists) {
        setError(
          'This email is already registered. Please use a different email or login.'
        );
      } else {
        setError('');
      }
    }
  };

  const handleAutoFill = () => {
    setFormData((prev) => ({
      ...prev,
      email: 'guest@cryptozen.com',
      username: generateUsername('guest@cryptozen.com'),
      name: 'Guest',
      password: 'CryptoZen123!',
      confirmPassword: 'CryptoZen123!',
    }));

    setAutofilled(true);
  };

  const validatePassword = (password) => {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    if (password.length < minLength) {
      return 'Password must be at least 8 characters long';
    }
    if (!hasUpperCase || !hasLowerCase) {
      return 'Password must contain both uppercase and lowercase letters';
    }
    if (!hasNumbers) {
      return 'Password must contain at least one number';
    }
    if (!hasSpecialChar) {
      return 'Password must contain at least one special character';
    }
    return '';
  };

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

    // Check email uniqueness before submitting
    const emailExists = await checkEmailExists(formData.email);
    if (emailExists) {
      setError(
        'This email is already registered. Please use a different email or login.'
      );
      return;
    }

    setLoading(true);
    try {
      const { confirmPassword, ...registrationData } = formData;
      const registerResponse = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/auth/register`,
        registrationData
      );

      if (registerResponse.data && registerResponse.data.success) {
        try {
          const loginResponse = await axios.post(
            `${process.env.REACT_APP_API_URL}/api/auth/login`,
            {
              email: formData.email,
              password: formData.password,
            }
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

            axios.defaults.headers.common[
              'Authorization'
            ] = `Bearer ${loginResponse.data.token}`;

            navigate('/dashboard');
          } else {
            throw new Error('Invalid login response');
          }
        } catch (loginError) {
          console.error('Auto-login error:', loginError);
          setError('Registration successful. Please login manually.');
          navigate('/login');
        }
      } else {
        setError('Registration failed. Please try again.');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError(
        err.response?.data?.message || 'Registration failed. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.authContainer}>
      <div style={styles.authCard}>
        <div style={styles.authHeader}>
          <h2 style={styles.authTitle}>Create Account</h2>
          <p style={styles.authSubtitle}>
            Join thousands of crypto traders worldwide
          </p>
        </div>

        <form onSubmit={handleSubmit} style={styles.authForm}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Full Name</label>
            <input
              type='text'
              name='name'
              value={formData.name}
              onChange={handleChange}
              style={styles.input}
              placeholder='John Doe'
              required
              disabled={loading}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              type='email'
              name='email'
              value={formData.email}
              onChange={handleEmailChange}
              style={styles.input}
              placeholder='your@email.com'
              required
              disabled={loading}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Username</label>
            <input
              type='text'
              name='username'
              value={formData.username}
              onChange={handleChange}
              style={styles.input}
              placeholder='johndoe123'
              required
              disabled={loading}
              pattern='[a-zA-Z0-9]+'
              title='Username can only contain letters and numbers'
            />
            <small style={styles.helperText}>
              Username can only contain letters and numbers
            </small>
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
              minLength='8'
              disabled={loading}
            />
            <small style={styles.helperText}>
              Password must be at least 8 characters long and contain uppercase,
              lowercase, number, and special character
            </small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Confirm Password</label>
            <input
              type='password'
              name='confirmPassword'
              value={formData.confirmPassword}
              onChange={handleChange}
              style={styles.input}
              placeholder='••••••••'
              required
              minLength='8'
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
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <div style={styles.authLinks}>
            <div style={styles.authDivider}>
              <span style={styles.authDividerText}>
                Already have an account?
              </span>
            </div>
            <Link to='/login' style={styles.authLinkSecondary}>
              Login Here
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
          <button type='button' onClick={handleAutoFill}>
            Auto Fill
          </button>
        </form>
      </div>
    </div>
  );
};

export default Register;

