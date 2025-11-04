import React, { useState } from 'react';
import styles from '../styles/globalStyles';
import useUserStore from '../store/userStore';

const Settings = () => {
  const user = useUserStore((state) => state.user) || {};
  const [formData, setFormData] = useState({
    fullName: user.name || '',
    email: user.email || '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    notifications: {
      email: true,
      price: true,
      news: false,
      trading: true
    },
    currency: 'USD',
    theme: 'light'
  });

  const [message, setMessage] = useState({ type: '', text: '' });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (type === 'checkbox') {
      setFormData(prev => ({
        ...prev,
        notifications: {
          ...prev.notifications,
          [name]: checked
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // TODO: Implement settings update
    setMessage({ type: 'success', text: 'Settings updated successfully!' });
  };

  return (
    <div style={styles.dashboardContainer}>
      <div style={styles.dashboardSection}>
        <h2 style={styles.sectionTitle}>Account Settings</h2>
        
        <div style={styles.settingsCard}>
          <form onSubmit={handleSubmit} style={styles.settingsForm}>
            {/* Profile Settings */}
            <div style={styles.settingsSection}>
              <h3 style={styles.settingsSectionTitle}>Profile Information</h3>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Full Name</label>
                <input
                  type="text"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  style={styles.input}
                  disabled
                />
                <small style={styles.helperText}>
                  Email cannot be changed. Contact support if needed.
                </small>
              </div>
            </div>

            {/* Password Change */}
            <div style={styles.settingsSection}>
              <h3 style={styles.settingsSectionTitle}>Change Password</h3>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Current Password</label>
                <input
                  type="password"
                  name="currentPassword"
                  value={formData.currentPassword}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>New Password</label>
                <input
                  type="password"
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Confirm New Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
            </div>

            {/* Preferences */}
            <div style={styles.settingsSection}>
              <h3 style={styles.settingsSectionTitle}>Preferences</h3>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Display Currency</label>
                <select
                  name="currency"
                  value={formData.currency}
                  onChange={handleChange}
                  style={styles.select}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="JPY">JPY</option>
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Theme</label>
                <select
                  name="theme"
                  value={formData.theme}
                  onChange={handleChange}
                  style={styles.select}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            </div>

            {/* Notifications */}
            <div style={styles.settingsSection}>
              <h3 style={styles.settingsSectionTitle}>Notifications</h3>
              
              <div style={styles.checkboxGroup}>
                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    name="email"
                    checked={formData.notifications.email}
                    onChange={handleChange}
                    style={styles.checkbox}
                  />
                  Email Notifications
                </label>

                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    name="price"
                    checked={formData.notifications.price}
                    onChange={handleChange}
                    style={styles.checkbox}
                  />
                  Price Alerts
                </label>

                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    name="news"
                    checked={formData.notifications.news}
                    onChange={handleChange}
                    style={styles.checkbox}
                  />
                  News Updates
                </label>

                <label style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    name="trading"
                    checked={formData.notifications.trading}
                    onChange={handleChange}
                    style={styles.checkbox}
                  />
                  Trading Notifications
                </label>
              </div>
            </div>

            {message.text && (
              <div
                style={
                  message.type === 'error'
                    ? styles.errorMessage
                    : styles.successMessage
                }
              >
                {message.text}
              </div>
            )}

            <button type="submit" style={styles.submitButton}>
              Save Changes
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Settings;
 