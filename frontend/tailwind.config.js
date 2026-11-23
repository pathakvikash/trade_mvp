/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        surface: {
          DEFAULT: '#0f172a',
          muted: '#111827',
          panel: '#16202a',
          border: '#334155',
          alt: '#0b1120',
        },
        positive: '#10b981',
        negative: '#ef4444',
        warning: '#f59e0b',
      },
      boxShadow: {
        soft: '0 18px 60px rgba(15, 23, 42, 0.18)',
      },
      keyframes: {
        'auth-grid': { from: { backgroundPosition: '0 0' }, to: { backgroundPosition: '48px 48px' } },
        'auth-glow': { '0%, 100%': { opacity: '0.55', transform: 'translate3d(0,0,0) scale(1)' }, '50%': { opacity: '0.9', transform: 'translate3d(2%,-3%,0) scale(1.08)' } },
        'auth-rise': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'auth-sweep': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(100%)' } },
      },
      animation: {
        'auth-grid': 'auth-grid 14s linear infinite',
        'auth-glow': 'auth-glow 12s ease-in-out infinite',
        'auth-rise': 'auth-rise 0.5s ease-out both',
        'auth-sweep': 'auth-sweep 1.6s ease-in-out infinite',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

