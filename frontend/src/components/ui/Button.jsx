import React from 'react';

const variantStyles = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500 focus:ring-brand-500',
  secondary: 'bg-slate-800 text-slate-100 hover:bg-slate-700 focus:ring-slate-600',
  success: 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 focus:ring-emerald-400',
  danger: 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-500',
  outline: 'border border-slate-700 bg-transparent text-slate-100 hover:bg-slate-900 focus:ring-slate-500',
};

const Button = ({ type = 'button', variant = 'primary', className = '', children, ...props }) => {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold transition duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 ${variantStyles[variant] || variantStyles.primary} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
