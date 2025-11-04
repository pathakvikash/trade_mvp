// src/pages/Home.js
import React from 'react';
import { Link } from 'react-router-dom';
import styles from '../styles/globalStyles';

const Home = () => {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Welcome to CryptoZen</h1>
      <p style={styles.subtitle}>
        Experience seamless cryptocurrency trading with our cutting-edge platform.
        Low fees, real-time updates, and secure transactions at your fingertips.
      </p>

      <div style={styles.buttonContainer}>
        <Link to='/login'>
          <button style={styles.button}>Get Started</button>
        </Link>
        <Link to='/register'>
          <button style={{...styles.button, backgroundColor: 'transparent', border: '2px solid #2563eb', color: '#2563eb'}}>
            Create Account
          </button>
        </Link>
      </div>

      <div style={{marginTop: '60px', display: 'flex', gap: '40px', justifyContent: 'center'}}>
        <div style={{textAlign: 'center', maxWidth: '200px'}}>
          <h3 style={{color: '#1e293b', marginBottom: '8px'}}>Low Fees</h3>
          <p style={{color: '#64748b'}}>Industry-leading rates for all trades</p>
        </div>
        <div style={{textAlign: 'center', maxWidth: '200px'}}>
          <h3 style={{color: '#1e293b', marginBottom: '8px'}}>Secure</h3>
          <p style={{color: '#64748b'}}>Enterprise-grade security protocols</p>
        </div>
        <div style={{textAlign: 'center', maxWidth: '200px'}}>
          <h3 style={{color: '#1e293b', marginBottom: '8px'}}>24/7 Trading</h3>
          <p style={{color: '#64748b'}}>Trade anytime, anywhere</p>
        </div>
      </div>

      <footer style={styles.footer}>
        <p>&copy; 2024 CryptoZen. All rights reserved.</p>
      </footer>
    </div>
  );
};

export default Home;
