'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Truck,
  UserCheck,
  Menu,
  Radio,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuth } from '../lib/authContext';

interface BottomNavProps {
  onOpenMobileNav: () => void;
}

export default function BottomNav({ onOpenMobileNav }: BottomNavProps) {
  const pathname = usePathname();
  const { user, hasPageAccess } = useAuth();

  if (!user) return null;

  // Primary bottom navigation items (accessible by current user role)
  const primaryItems = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Plant', href: '/plants', icon: Building2 },
    { name: 'Vehicles', href: '/vehicles', icon: Truck },
    { name: 'Drivers', href: '/drivers', icon: UserCheck },
    { name: 'GPS', href: '/gps', icon: Radio },
  ].filter((item) => hasPageAccess(item.name === 'Vehicles' ? 'Vehicle Register' : item.name === 'Drivers' ? 'Driver Registry' : item.name));

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800/90 shadow-2xl px-2 py-1.5 safe-area-bottom select-none"
    >
      <div className="flex items-center justify-around max-w-lg mx-auto">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1 px-1.5 rounded-xl transition-all duration-150 ${
                isActive
                  ? 'text-emerald-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200 active:scale-95'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  isActive ? 'bg-emerald-500/15 text-emerald-400' : ''
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] tracking-tight leading-none mt-1">
                {item.name}
              </span>
            </Link>
          );
        })}

        {/* Hamburger "More" trigger to open full drawer */}
        <button
          type="button"
          onClick={onOpenMobileNav}
          className="flex flex-col items-center justify-center min-w-[56px] min-h-[48px] py-1 px-1.5 rounded-xl text-slate-400 hover:text-slate-200 active:scale-95 transition-all cursor-pointer"
          aria-label="Open More Menu"
        >
          <div className="p-1 rounded-lg hover:bg-slate-800">
            <Menu className="w-5 h-5 text-slate-400" />
          </div>
          <span className="text-[10px] tracking-tight leading-none mt-1">
            More
          </span>
        </button>
      </div>
    </nav>
  );
}
