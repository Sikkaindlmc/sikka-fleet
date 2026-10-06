'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Truck,
  Radio,
  Users,
  LogOut,
  ShieldCheck,
  User,
  UserCheck,
  FileSpreadsheet,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../lib/authContext';

export const NAV_ITEMS = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Plant', href: '/plants', icon: Building2 },
  { name: 'Vehicle Register', href: '/vehicles', icon: Truck },
  { name: 'Driver Registry', href: '/drivers', icon: UserCheck },
  { name: 'GPS', href: '/gps', icon: Radio },
  { name: 'Report', href: '/reports', icon: FileSpreadsheet },
  { name: 'User Management', href: '/users', icon: Users },
  { name: 'Sikka AI', href: '/sikka-ai', icon: Sparkles, isAi: true },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, logout, hasPageAccess } = useAuth();

  // Filter navigation items by role and assigned page permissions
  const allowedNav = NAV_ITEMS.filter((item) => hasPageAccess(item.name));

  return (
    <aside className="hidden lg:flex flex-col w-64 bg-slate-900 text-white shrink-0 border-r border-slate-800 shadow-xl select-none">
      {/* Brand Header */}
      <div className="flex flex-col px-6 py-5 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center p-1.5 shadow-md shadow-emerald-500/10 shrink-0">
            <img src="/logo.png" alt="Sikka Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="font-extrabold text-lg tracking-tight leading-tight text-white">
              Sikka Fleet
            </h1>
            <span className="text-xs font-medium text-emerald-400 tracking-wider uppercase">
              Sikka LMC
            </span>
          </div>
        </div>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          Fleet Operations
        </div>
        {allowedNav.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all duration-150 ${
                isActive
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/25'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Icon
                className={`w-5 h-5 ${
                  isActive ? 'text-slate-950' : 'text-slate-400 group-hover:text-white'
                }`}
              />
              <span className="flex-1">{item.name}</span>
              {(item as { isAi?: boolean }).isAi && (
                <span
                  className={`text-[10px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                    isActive
                      ? 'bg-slate-950 text-emerald-400'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  AI
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Information & Logout */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/60">
        <div className="flex items-center gap-3 px-2 py-2 mb-2 rounded-xl bg-slate-800/40">
          <div className="w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center text-slate-300">
            {user?.role === 'Admin' ? (
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            ) : (
              <User className="w-5 h-5 text-slate-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-white truncate">
              {user?.fullName || 'User'}
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              @{user?.username || 'user'} • {user?.role || 'Operator'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold text-rose-400 hover:text-white hover:bg-rose-600/20 border border-rose-500/20 transition cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
