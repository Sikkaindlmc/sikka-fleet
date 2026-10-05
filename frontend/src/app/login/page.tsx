'use client';

import React, { useState, useEffect } from 'react';
import LoginAnimation from '../../components/LoginAnimation';
import LoginForm from '../../components/LoginForm';

export default function LoginPage() {
  const [animationComplete, setAnimationComplete] = useState(false);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState('/dashboard');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('expired') === '1') {
        setSessionExpiredNotice(true);
      }
      const redir = params.get('redirect');
      if (redir && redir.startsWith('/') && !redir.startsWith('//')) {
        setRedirectUrl(redir);
      }
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-slate-950 px-4 py-12 relative overflow-hidden select-none">
      {/* Requirement 20: Stylish 3-second entrance animation on login page */}
      <LoginAnimation
        isComplete={animationComplete}
        onComplete={() => setAnimationComplete(true)}
      />

      {/* Decorative ambient background radial gradients */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-emerald-600/10 via-teal-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Main Content (fades in smoothly with 3s animation completion) */}
      <div
        className={`w-full max-w-md flex flex-col items-center relative z-10 transition-all duration-1000 transform ${
          animationComplete
            ? 'opacity-100 translate-y-0 scale-100'
            : 'opacity-0 translate-y-6 scale-95'
        }`}
      >
        {/* Brand Header */}
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-white p-2.5 shadow-xl shadow-emerald-500/15 mb-4 border border-emerald-400/40 flex items-center justify-center">
            <img src="/logo.png" alt="Sikka Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight leading-tight">
            Sikka Fleet
          </h1>
          <span className="text-[11px] font-extrabold text-emerald-400 uppercase tracking-widest mt-1 block">
            Sikka LMC • Fleet Management System
          </span>
        </div>

        {/* Separated Login Form Component (Requirement 22) */}
        <LoginForm
          redirectUrl={redirectUrl}
          sessionExpiredNotice={sessionExpiredNotice}
        />

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-slate-500 font-medium">
          &copy; {new Date().getFullYear()} Sikka LMC. All rights reserved.
        </p>
      </div>
    </div>
  );
}
