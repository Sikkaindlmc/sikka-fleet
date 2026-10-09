'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import MobileNav from './MobileNav';
import PlantPlanNotificationIcon from './PlantPlanNotificationIcon';
import { useAuth } from '../lib/authContext';

interface AppLayoutProps {
  children: React.ReactNode;
  pageTitle: string;
  requiredPage?: string;
}

export default function AppLayout({
  children,
  pageTitle,
  requiredPage,
}: AppLayoutProps) {
  const { user, isLoading, hasPageAccess } = useAuth();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    } else if (user && user.role === 'Driver' && requiredPage && requiredPage !== 'Dashboard') {
      // Requirement 12: Reject access and immediately redirect Driver back to Dashboard
      router.replace('/dashboard');
    }
  }, [user, isLoading, requiredPage, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center font-black text-2xl text-slate-950 mb-4 animate-pulse">
          S
        </div>
        <p className="text-sm font-semibold tracking-wide text-slate-300">
          Loading Sikka Fleet...
        </p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Enforce page authorization
  if (requiredPage && !hasPageAccess(requiredPage)) {
    return (
      <div className="flex h-screen bg-slate-100 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header onOpenMobileNav={() => setMobileNavOpen(true)} title={pageTitle} />
          <MobileNav isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
          <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-md w-full p-8 bg-white rounded-2xl shadow-xl border border-slate-200">
              <div className="w-14 h-14 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Access Restricted</h2>
              <p className="text-sm text-slate-600 mb-6">
                You do not have administrative permission to view the <strong className="text-slate-800">{requiredPage}</strong> page. Please contact your system administrator to adjust your permissions.
              </p>
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Return to Dashboard
              </button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Mobile Drawer */}
      <MobileNav isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} title={pageTitle} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {/* Global Plant Plan Notification Icon & Panel (Visible Across All Pages) */}
      <PlantPlanNotificationIcon />
    </div>
  );
}
