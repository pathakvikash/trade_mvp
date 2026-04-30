import React, { useState } from 'react';
import useUserStore from '../store/userStore';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';

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
    <div className="space-y-6">
      <Card>
        <h2 className="mb-6 text-xl font-semibold text-white">Account Settings</h2>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Profile Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white">Profile Information</h3>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">Full Name</label>
              <Input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">Email</label>
              <Input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                disabled
              />
              <p className="text-xs text-slate-500">
                Email cannot be changed. Contact support if needed.
              </p>
            </div>
          </div>

          {/* Password Change */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white">Change Password</h3>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">Current Password</label>
              <Input
                type="password"
                name="currentPassword"
                value={formData.currentPassword}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">New Password</label>
              <Input
                type="password"
                name="newPassword"
                value={formData.newPassword}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-300">Confirm New Password</label>
              <Input
                type="password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Preferences */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white">Preferences</h3>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Display Currency</label>
                <Select
                  name="currency"
                  value={formData.currency}
                  onChange={handleChange}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="JPY">JPY</option>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-slate-300">Theme</label>
                <Select
                  name="theme"
                  value={formData.theme}
                  onChange={handleChange}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </Select>
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-white">Notifications</h3>

            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="email"
                  checked={formData.notifications.email}
                  onChange={handleChange}
                  className="rounded border-slate-600 bg-slate-800 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-300">Email Notifications</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="price"
                  checked={formData.notifications.price}
                  onChange={handleChange}
                  className="rounded border-slate-600 bg-slate-800 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-300">Price Alerts</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="news"
                  checked={formData.notifications.news}
                  onChange={handleChange}
                  className="rounded border-slate-600 bg-slate-800 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-300">News Updates</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="trading"
                  checked={formData.notifications.trading}
                  onChange={handleChange}
                  className="rounded border-slate-600 bg-slate-800 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm text-slate-300">Trading Notifications</span>
              </label>
            </div>
          </div>

          {message.text && (
            <div className={`rounded-2xl border p-4 ${message.type === 'error'
                ? 'border-red-800/50 bg-red-950/20 text-red-300'
                : 'border-emerald-800/50 bg-emerald-950/20 text-emerald-300'
              }`}>
              {message.text}
            </div>
          )}

          <Button type="submit" className="w-full md:w-auto">
            Save Changes
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default Settings;
