'use client';

import React from 'react';
import { Menu, User, LogOut, Shield } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import SikkaAiPanel from './SikkaAiPanel';

interface HeaderProps {
  onOpenMobileNav: () => void;
  title?: string;
}

export default function Header({ onOpenMobileNav, title }: HeaderProps) {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-[60] flex items-center justify-between h-16 px-4 sm:px-6 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl lg:hidden transition cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 font-black text-sm lg:hidden shadow-xs">
            S
          </div>
          <div>
            <span className="text-base font-extrabold text-slate-900 tracking-tight lg:hidden">
              Sikka Fleet
            </span>
            {title && (
              <h2 className="hidden lg:block text-lg font-bold text-slate-800 tracking-tight">
                {title}
              </h2>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:gap-4">
        {user && <SikkaAiPanel />}
        {/* User Badge */}
        <div className="flex items-center gap-2.5 pl-3 py-1 pr-2 rounded-full bg-slate-50 border border-slate-200/70">
          <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs">
            {user?.role === 'Admin' ? (
              <Shield className="w-3.5 h-3.5 text-emerald-700" />
            ) : (
              <User className="w-3.5 h-3.5 text-emerald-700" />
            )}
          </div>
          <div className="hidden sm:block text-left">
            <span className="block text-xs font-bold text-slate-800 leading-tight">
              {user?.fullName || 'User'}
            </span>
            <span className="block text-[10px] font-semibold text-emerald-700 leading-none">
              {user?.role || 'Operator'}
            </span>
          </div>
        </div>

        {/* Quick Logout Button */}
        <button
          type="button"
          onClick={logout}
          title="Logout"
          className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
          aria-label="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
