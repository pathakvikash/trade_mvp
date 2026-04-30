// src/pages/Home.js
import React from 'react';
import { Link } from 'react-router-dom';

const Home = () => {
  return (
    <div className="flex min-h-full flex-col bg-slate-950 px-4 py-10 text-slate-100 md:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center text-center">
        <h1 className="bg-gradient-to-r from-blue-400 to-brand-500 bg-clip-text text-4xl font-bold text-transparent md:text-6xl">
          Welcome to CryptoZen
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-slate-400 md:text-lg">
          Experience seamless cryptocurrency trading with our cutting-edge platform.
          Low fees, real-time updates, and secure transactions at your fingertips.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            to='/login'
            className="rounded-2xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-500"
          >
            Get Started
          </Link>
          <Link
            to='/register'
            className="rounded-2xl border border-brand-500 px-6 py-3 text-sm font-semibold text-brand-300 transition hover:border-brand-400 hover:text-brand-200"
          >
            Create Account
          </Link>
        </div>

        <div className="mt-12 grid w-full max-w-4xl gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 text-left">
            <h3 className="mb-2 text-lg font-semibold text-white">Low Fees</h3>
            <p className="text-sm text-slate-400">Industry-leading rates for all trades</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 text-left">
            <h3 className="mb-2 text-lg font-semibold text-white">Secure</h3>
            <p className="text-sm text-slate-400">Enterprise-grade security protocols</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 text-left">
            <h3 className="mb-2 text-lg font-semibold text-white">24/7 Trading</h3>
            <p className="text-sm text-slate-400">Trade anytime, anywhere</p>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-10 w-full max-w-5xl border-t border-slate-800 pt-5 text-center text-sm text-slate-500">
        <p>&copy; 2024 CryptoZen. All rights reserved.</p>
      </div>
    </div>
  );
};

export default Home;
